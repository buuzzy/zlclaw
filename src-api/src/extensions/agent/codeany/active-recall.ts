/**
 * Phase 4 Active Recall — Per-Query Memory Association
 *
 * Phase 3 注入的是「全局静态画像」（hard_rules / preferences / active focus），
 * 与当前用户 query 无关。本文件补上「按当前 query 实时召回相关历史片段」
 * 这条独立通道——agent 在首轮就被告知「跟这次提问相关的历史细节」，
 * 不再需要 LLM 主动决策调 search_memory 才能联想到。
 *
 * 触发位置：仅在 task 的首轮 user message 时触发（conversation 为空 / plan / execute）。
 * 后续 turn 不再重跑——首轮注入的内容会随 system prompt 留在整段对话上下文里。
 *
 * 详见 docs/memory/phase3-design.md 「Phase 4」补充章节
 *
 * 双模式（与 persona-injector / mcp-memory 一致）：
 *   · 桌面端 sidecar：accessToken 必传 → user-scoped client，受 RLS 保护
 *   · Railway 等服务器：accessToken 可选 → service-role client，应用层显式按 user_id 过滤
 *
 * Feature flag：
 *   process.env.SAGE_ENABLE_ACTIVE_RECALL
 *     · 'false'/'0'/'off' → 关闭注入（兼容回滚）
 *     · 其他值（含未设置）→ 开启（v1.4.0 默认开启）
 *
 * 失败处理：
 *   · 任何错误（数据库不可达、FTS 异常等）静默返回空字符串
 *   · 不阻塞主对话流；最坏情况是 agent 这一轮失去主动联想能力，下一轮还会再试
 */

import { SupabaseRpcMemoryProvider } from '@/shared/memory/supabase-rpc-provider';
import { isSupabaseConfigured } from '@/shared/supabase/client';
import type { MemoryRecord } from '@/shared/memory/provider';

// ─── Constants ──────────────────────────────────────────────────────────────

/** 召回数量上限（vision 坑 3「宁可漏不要烦」明确 top 2）*/
const RECALL_LIMIT = 2;

/** 单条片段截断长度，避免 prompt 膨胀 */
const SNIPPET_TRUNC = 200;

/** 自我召回过滤窗口：忽略最近 N 分钟内的 message（防止召回到当前 task 自己刚写入的提问）*/
const SELF_RECALL_FILTER_MINUTES = 5;

// ─── Feature flag ───────────────────────────────────────────────────────────

function isRecallEnabled(): boolean {
  const v = (process.env.SAGE_ENABLE_ACTIVE_RECALL ?? '').toLowerCase().trim();
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return true;
}

// ─── First-turn detection ───────────────────────────────────────────────────

interface FirstTurnInput {
  /** Run mode 时传入；plan/execute 模式不传（视为必首轮）*/
  conversation?: readonly unknown[];
  /** 强制视为首轮（plan/execute 调用时传 true）*/
  forceFirstTurn?: boolean;
}

function isFirstTurn(input: FirstTurnInput): boolean {
  if (input.forceFirstTurn) return true;
  const conv = input.conversation;
  if (!conv) return true;
  return conv.length === 0;
}

// ─── Time impressionizer ────────────────────────────────────────────────────

/**
 * 把精确 ISO 时间戳转成印象式相对短语，与 SOUL.md 原则一一致。
 *
 * 原则：被动召回时不暴露精确时间戳；用户主动追问时才解锁档案模式。
 * 这里属于被动召回路径，所以一律印象化。
 */
function impressionizeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '前段时间';
  const now = Date.now();
  const days = Math.max(0, Math.floor((now - t) / (1000 * 60 * 60 * 24)));
  if (days <= 1) return '昨天';
  if (days <= 3) return '前两天';
  if (days <= 7) return '前几天';
  if (days <= 21) return '前段时间';
  if (days <= 60) return '上个月';
  if (days <= 180) return '几个月前';
  if (days <= 365) return '半年多前';
  return '一年多前';
}

// ─── Role label ─────────────────────────────────────────────────────────────

/**
 * 把 messages.type 转成"用户/你"——前者指 end-user，后者指 agent 自己（Sage）。
 * 注意：对 LLM 而言"你"= Sage 自己，所以"你 当时回答"读起来是它自己回想。
 */
function roleLabel(type: string): string {
  if (type === 'user') return '用户当时问';
  return '你当时回应';
}

// ─── Snippet rendering ──────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function renderSnippet(rec: MemoryRecord): string {
  const when = impressionizeTime(rec.createdAt);
  const who = roleLabel(rec.type);
  const text = truncate((rec.content ?? '').replace(/\s+/g, ' ').trim(), SNIPPET_TRUNC);
  if (!text) return '';
  return `- [${when}] ${who}：${text}`;
}

// ─── Self-recall filter ─────────────────────────────────────────────────────

/**
 * 过滤掉「最近 N 分钟内」的 message——防止刚写入的当前 task 提问被自己召回。
 *
 * search_messages RPC 当前没有 exclude_task_id 参数，加这层时间过滤
 * 是 MVP 阶段最简洁的兜底（user message 双写到云端通常有 < 1s 延迟，
 * 5 分钟窗口足够覆盖；副作用是用户在 5 分钟内重复提同一问题时不会
 * 召回前一次的对话——产品上反而合理，因为前一次还在视野里）。
 */
function filterSelfRecall(records: MemoryRecord[]): MemoryRecord[] {
  const cutoff = Date.now() - SELF_RECALL_FILTER_MINUTES * 60 * 1000;
  return records.filter((r) => {
    const t = new Date(r.createdAt).getTime();
    if (Number.isNaN(t)) return true;
    return t < cutoff;
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface BuildActiveRecallOptions {
  /** 当前用户 query。用作 FTS 检索词。*/
  prompt: string;
  /** Supabase auth.uid()——必传，否则跳过 */
  userId?: string;
  /** 用户 JWT，桌面端必传；Railway 等可不传（走 service-role）*/
  accessToken?: string;
  /** Run mode 才传 conversation 用于首轮判断（仅看 length，不解构内部字段）*/
  conversation?: readonly unknown[];
  /** plan/execute 模式传 true，跳过 conversation 检查 */
  forceFirstTurn?: boolean;
}

/**
 * 按当前 query 实时召回相关历史片段，渲染成 markdown 段落。
 *
 * 返回字符串可直接 append 到 system prompt 末尾。
 * 非首轮 / 注入关闭 / 无召回 / 任何错误 → 返回空字符串（不污染 prompt）。
 */
export async function buildActiveRecallSection(
  opts: BuildActiveRecallOptions
): Promise<string> {
  if (!opts.userId) return '';
  if (!isRecallEnabled()) return '';
  if (!isSupabaseConfigured()) return '';
  if (!isFirstTurn(opts)) return '';

  const trimmed = (opts.prompt ?? '').trim();
  if (trimmed.length < 2) return '';

  try {
    const provider = new SupabaseRpcMemoryProvider();
    const records = await provider.search(
      trimmed,
      { userId: opts.userId, accessToken: opts.accessToken },
      { limit: RECALL_LIMIT + 3 } // 多召几条留给 self-recall filter 过滤后再截断
    );

    const filtered = filterSelfRecall(records).slice(0, RECALL_LIMIT);
    if (filtered.length === 0) return '';

    const lines: string[] = [];
    for (const r of filtered) {
      const line = renderSnippet(r);
      if (line) lines.push(line);
    }
    if (lines.length === 0) return '';

    return [
      '## 与当前问题相关的历史片段（你已经主动想起来的，不是查出来的）',
      '',
      '系统在你回答前已经从这位用户的历史对话里召回了 1-2 条与当前问题最相关的片段。',
      '**仅当真的能帮助回答时才主动提及**——不要为了用而用，宁可漏不要烦（参见 SOUL.md 原则一）。',
      '',
      '引用时遵守两点：',
      '1. 用印象式语言衔接（"印象里你前段时间提过…"、"记得你上个月聊到过…"），不要照搬下面的标签结构',
      '2. 不要把方括号里的相对时间词原样输出（"[前几天]"），它是给你看的提示，不是给用户看的字幕',
      '',
      ...lines,
      '',
    ].join('\n');
  } catch (e) {
    console.warn(
      `[active-recall] build failed: ${e instanceof Error ? e.message : String(e)}`
    );
    return '';
  }
}
