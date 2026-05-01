/**
 * Phase 3 Persona Injector
 *
 * 在每次 agent 对话开始前，从 Supabase persona_memory 拉用户画像 +
 * recent_threads，渲染成 markdown 段落注入到 system prompt。
 *
 * 这是「记忆即身份」本体论的具体实现——agent 在每次对话开始前已经
 * 处于「认识这个用户」的状态，不需要工具决策何时召回。
 *
 * 详见 docs/memory/phase3-design.md 决策 4 + memory-philosophy.md §1
 *
 * 双模式（与 mcp-memory 一致）：
 *   · 桌面端 sidecar：accessToken 必传 → user-scoped client，受 RLS 保护
 *   · Railway 等服务器：accessToken 可选 → service-role client，应用层显式按 user_id 过滤
 *
 * Feature flag：
 *   process.env.SAGE_INJECT_PERSONA
 *     · 'false'/'0'/'off' → 关闭注入（兼容回滚）
 *     · 其他值（含未设置）→ 开启（v1.3.0 默认开启）
 *
 * 失败处理：
 *   · 任何错误（数据库不可达、JSON 解析失败等）静默返回空字符串
 *   · 不阻塞主对话流；用户感受到的最坏情况是「这次对话 agent 像不认识我」，
 *     但下一次对话蒸馏更新后又会回来
 */

import {
  createUserScopedSupabase,
  getServiceSupabase,
  isServiceRoleAvailable,
  isSupabaseConfigured,
} from '@/shared/supabase/client';
import {
  EMPTY_PROFILE,
  type PersonaMemoryRow,
  type PersonaProfile,
  type RecentThread,
} from '@/shared/types/persona-memory';

// ─── Constants ──────────────────────────────────────────────────────────────

/** recent_threads 预注入条数上限（token 预算控制） */
const RECENT_THREADS_INJECT_LIMIT = 20;

/** 单条 user 提问注入时的截断长度 */
const RECENT_THREAD_USER_TRUNC = 200;

/** 单条 agent_stance 注入时的截断长度 */
const RECENT_THREAD_STANCE_TRUNC = 80;

// ─── Feature flag ───────────────────────────────────────────────────────────

function isInjectionEnabled(): boolean {
  const v = (process.env.SAGE_INJECT_PERSONA ?? '').toLowerCase().trim();
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return true;
}

// ─── Persona fetch ──────────────────────────────────────────────────────────

async function fetchPersonaRow(
  userId: string,
  accessToken?: string
): Promise<PersonaMemoryRow | null> {
  if (!isSupabaseConfigured()) return null;

  // 优先 user-scoped（桌面端常态），fallback service-role（Railway 服务器）
  const client = accessToken
    ? createUserScopedSupabase(accessToken)
    : isServiceRoleAvailable()
    ? getServiceSupabase()
    : null;

  if (!client) return null;

  // 桌面端 user-scoped 模式下 RLS 自动按 auth.uid() 过滤；service-role 显式 .eq()
  let query = client.from('persona_memory').select('*');
  if (!accessToken) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query.maybeSingle();

  if (error) {
    console.warn(`[persona-injector] fetch failed: ${error.message}`);
    return null;
  }
  return data as PersonaMemoryRow | null;
}

// ─── Rendering helpers ──────────────────────────────────────────────────────

const RISK_LABELS: Record<string, string> = {
  conservative: '保守',
  moderate: '稳健',
  aggressive: '进取',
  speculative: '激进',
};

const CAP_LABELS: Record<string, string> = {
  novice: '新手',
  intermediate: '中级',
  advanced: '进阶',
  professional: '专业',
};

function renderProfile(profile: PersonaProfile): string {
  const lines: string[] = [];

  // ── 显式字段（用户主动声明区） ─────────────────────────────────────
  // 注意：所有标题都刻意避开"硬规则"、"声明"、"排除"等技术术语，
  // 因为这些字段最终会被 LLM 引用到回答里——用更口语化的过渡语，
  // 让 LLM 更容易模仿出印象式语气（详见 SOUL.md 原则一）。
  const ex = profile.explicit;
  const explicitLines: string[] = [];

  if (ex.hard_rules && ex.hard_rules.length > 0) {
    explicitLines.push('用户曾明确立过这些规则——他自己定的底线，违反时你应该让他自己看见矛盾，而非替他做决定（参见 SOUL.md 原则二，教练模式）：');
    explicitLines.push('');
    for (const r of ex.hard_rules) {
      explicitLines.push(`- ${r.content}`);
    }
  }

  const declared = ex.focus_universe?.declared ?? [];
  if (declared.length > 0) {
    if (explicitLines.length > 0) explicitLines.push('');
    explicitLines.push('用户主动告诉过你他在关注：');
    explicitLines.push('');
    for (const d of declared) {
      const code = d.code ? `（${d.code}）` : '';
      explicitLines.push(`- ${d.name}${code}`);
    }
  }

  const exclusions = ex.focus_universe?.exclusions ?? [];
  if (exclusions.length > 0) {
    if (explicitLines.length > 0) explicitLines.push('');
    explicitLines.push('用户主动告诉过你他不想碰的方向：');
    explicitLines.push('');
    for (const e of exclusions) {
      explicitLines.push(`- ${e.value}`);
    }
  }

  if (explicitLines.length > 0) {
    lines.push('## 用户曾经明确告诉过你的');
    lines.push('');
    lines.push(...explicitLines);
    lines.push('');
  }

  // ── 隐式字段（蒸馏推断区） ─────────────────────────────────────────
  const im = profile.implicit;
  const implicitLines: string[] = [];

  const active = im.focus_universe?.active ?? [];
  if (active.length > 0) {
    const top = active.slice(0, 8);
    const items = top
      .map((a) => (a.code ? `${a.name}(${a.code})` : a.name))
      .join('、');
    implicitLines.push(`- 近期对话里他常聊到：${items}`);
  }

  if (im.risk_tolerance && RISK_LABELS[im.risk_tolerance]) {
    implicitLines.push(`- 你感觉他的风格偏${RISK_LABELS[im.risk_tolerance]}`);
  }

  if (im.capability_level && CAP_LABELS[im.capability_level]) {
    implicitLines.push(`- 他在金融上的水平大致是${CAP_LABELS[im.capability_level]}水平`);
  }

  const prefs = im.preferences ?? {};
  const prefBits: string[] = [];
  if (prefs.language) prefBits.push(`语言偏好「${prefs.language}」`);
  if (prefs.explanation_style) prefBits.push(`解释风格偏好「${prefs.explanation_style}」`);
  if (prefs.response_length) prefBits.push(`回应详略偏好「${prefs.response_length}」`);
  if (prefBits.length > 0) {
    implicitLines.push(`- 沟通上：${prefBits.join('；')}`);
  }

  const views = im.recent_views ?? [];
  if (views.length > 0) {
    implicitLines.push('- 你印象中他近期持有的观点（可能会变）：');
    for (const v of views.slice(0, 5)) {
      implicitLines.push(`    · 关于 ${v.topic}：${v.stance}`);
    }
  }

  // Phase 4 / L4-light: 行为摘要——蒸馏 cron 从 90 天行为日志聚合的一段叙述
  const behaviorSummary = (im.behavior_summary ?? '').trim();
  if (behaviorSummary) {
    implicitLines.push('- 你对他最近这阵子在做什么的整体印象：');
    implicitLines.push(`    ${behaviorSummary}`);
  }

  if (implicitLines.length > 0) {
    lines.push('## 你对他的印象（从过去对话里慢慢形成的，不是档案）');
    lines.push('');
    lines.push(...implicitLines);
    lines.push('');
  }

  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function renderRecentThreads(threads: RecentThread[]): string {
  if (!threads || threads.length === 0) return '';

  // 取最近 N 条，按时间倒序展示（蒸馏侧已经倒序，这里防御性 slice）
  const items = threads.slice(0, RECENT_THREADS_INJECT_LIMIT);
  const lines: string[] = ['## 我们近期聊过的话题（最近优先）', ''];
  for (const t of items) {
    const user = truncate(t.user ?? '', RECENT_THREAD_USER_TRUNC);
    const stance = t.agent_stance
      ? `（你当时的立场：${truncate(t.agent_stance, RECENT_THREAD_STANCE_TRUNC)}）`
      : '';
    lines.push(`- 用户问：${user}${stance ? ' ' + stance : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * 拉用户的 persona_memory 并渲染成 system prompt 段落。
 *
 * 返回的字符串可直接 append 到 system prompt 末尾。
 * 没有 persona / 注入关闭 / 任何错误 → 返回空字符串（不污染 prompt）。
 *
 * @param userId Supabase auth.uid()
 * @param accessToken 当前用户 JWT（桌面端必传），不传则尝试用 service-role
 */
export async function buildPersonaSection(
  userId: string | undefined,
  accessToken?: string
): Promise<string> {
  if (!userId) return '';
  if (!isInjectionEnabled()) return '';

  try {
    const row = await fetchPersonaRow(userId, accessToken);
    if (!row) return '';

    const profile = (row.profile as PersonaProfile) ?? EMPTY_PROFILE;
    const recentThreads = (row.recent_threads as RecentThread[]) ?? [];

    const profileSection = renderProfile(profile);
    const threadsSection = renderRecentThreads(recentThreads);

    if (!profileSection && !threadsSection) return '';

    const header = [
      '# 关于这位用户（你已经认识他/她）',
      '',
      '以下是你对这位用户的认识。这不是检索结果——是你的「身份记忆」，',
      '在每次对话开始前已经预装载。基于这个本体回答用户当前的问题，',
      '让用户感觉到你认识他，而不是「刚刚查了一下他」。',
      '',
      '## 引用这些信息时的两条铁律（违反任何一条都会让用户出戏）',
      '',
      '**铁律 1 — 用印象式语言，不照搬术语。**',
      '',
      '✅ "印象里你提过不太碰高估值科技股…"  /  "记得你在跟踪宁德时代…"',
      '❌ "根据你的硬规则…"  /  "你的 user profile 显示…"  /  "系统记录显示…"',
      '',
      '上面 markdown 块里的"用户曾明确立过这些规则"是给你看的元数据，',
      '不是要让你原文搬到回答里。你引用它们时要说得像老朋友突然想起来，',
      '而不是档案管理员翻档案。',
      '',
      '**铁律 2 — 用户当前行为违反硬规则时，反问动机而非阻挡决策。**',
      '',
      '✅ 教练："你想这么做没问题。但是你之前定过 X，现在想突破是怎么考虑的？"',
      '❌ 守门员："你定过 X，所以不行。"',
      '❌ 建议者："考虑到你的 X，建议你 Y。"',
      '',
      '决策权 100% 留给用户。把矛盾摆出来 = 帮他自我觉察；替他做决定 = 越权。',
      '详见 SOUL.md「记忆使用的两条根本原则」。',
      '',
    ].join('\n');

    return [header, profileSection, threadsSection].filter(Boolean).join('\n');
  } catch (e) {
    console.warn(
      `[persona-injector] build failed: ${e instanceof Error ? e.message : String(e)}`
    );
    return '';
  }
}
