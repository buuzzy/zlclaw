/**
 * Phase 3 蒸馏：persona_memory + recent_threads 增量更新
 *
 * 职责（决策 6 修订版）：
 *   · 唯一负责所有 persona 字段的写入（包括 explicit + implicit）
 *   · 增量蒸馏：只看 last_distilled_at 之后的 messages
 *   · 同时识别用户立的硬规则、撤销/修改、隐式画像更新、recent_threads
 *
 * 触发方式：
 *   1. Railway 内嵌 node-cron，每天凌晨 2 点自动跑（北京时间）
 *   2. /internal/distill-cron HTTP endpoint 手动触发（含 token auth）
 *
 * 详见 docs/memory/phase3-design.md §5.1 Sprint 2
 */

import { mimoChatJson, MimoApiError } from '@/shared/llm/mimo';
import { getServiceSupabase } from '@/shared/supabase/client';
import {
  EMPTY_PROFILE,
  type PersonaMemoryRow,
  type PersonaProfile,
  type RecentThread,
} from '@/shared/types/persona-memory';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * 蒸馏 LLM 使用的 MiMo 模型。
 * 通过 MIMO_MODEL 环境变量切换，便于在不同套餐 / base_url 下选用对应型号：
 *   · 官方 API:    mimo-v2-flash / mimo-v2-pro / mimo-v2-omni
 *   · Coding Plan: MiMo-V2.5-Pro / MiMo-V2.5 / MiMo-V2-Pro / MiMo-V2-Omni
 * 默认 mimo-v2-flash（官方 API 入门级，结构化 JSON 已足够）。
 */
const DISTILL_MODEL = process.env.MIMO_MODEL?.trim() || 'mimo-v2-flash';

/** 单次蒸馏拉取消息上限（防止用户消息暴增时拖垮蒸馏） */
const MAX_NEW_MESSAGES_PER_RUN = 500;

/** recent_threads 保留条数 */
const RECENT_THREADS_LIMIT = 20;

/** 蒸馏超时（首次全量蒸馏可能较慢） */
const DISTILL_TIMEOUT_MS = 120_000;

// ─── Prompt（inline，避免 runtime file I/O） ─────────────────────────────────

const DISTILL_SYSTEM_PROMPT = `你是 Sage 数字分身的「记忆消化模块」。你的任务是阅读用户与 Sage 的对话历史，提取并更新这位用户的画像（persona_memory）和近期对话摘要（recent_threads）。

# 你的输出形式

严格按照以下 JSON schema 输出。不允许添加任何字段，不允许省略任何字段，所有数组没有时返回 [], 所有可空字段没有时返回 null。

{
  "profile": {
    "explicit": {
      "hard_rules": [
        { "id": "string", "content": "string", "source_quote": "string|null", "created_at": "ISO timestamp" }
      ],
      "focus_universe": {
        "declared": [
          { "type": "stock|fund|sector|topic", "code": "string|null", "name": "string", "added_at": "ISO timestamp" }
        ],
        "exclusions": [
          { "type": "category|stock|sector", "value": "string", "reason_quote": "string|null", "added_at": "ISO timestamp" }
        ]
      }
    },
    "implicit": {
      "focus_universe": {
        "active": [
          { "type": "stock|fund|sector|topic", "code": "string|null", "name": "string", "frequency_score": 0.0 }
        ]
      },
      "risk_tolerance": "conservative|moderate|aggressive|speculative|null",
      "capability_level": "novice|intermediate|advanced|professional|null",
      "preferences": {
        "explanation_style": "string|null",
        "response_length": "string|null",
        "language": "string|null"
      },
      "recent_views": [
        { "topic": "string", "stance": "string", "ts": "ISO timestamp" }
      ]
    }
  },
  "recent_threads": [
    { "user": "string", "agent_stance": "string|null", "ts": "ISO timestamp" }
  ]
}

# 字段填写原则（必读）

## explicit 字段（用户主动声明区）

严格按用户原话识别，不发挥、不归纳、不创造。

### explicit.hard_rules
用户明确说出的硬规则、禁忌、底线。识别信号：
- "以后不要..."、"永远不要..."、"我不（再）..."、"我永远..."、"我从不..."、"我决不..."
- "所有 X 都不能..."、"任何 X 都..."、"我的原则是..."、"我的底线..."
不要把临时倾向当硬规则。"我现在不太想买" 是临时观点（→ recent_views），不是规则。

### explicit.focus_universe.declared
用户明确说出要加入关注/常聊的对象。识别信号：
- "我关注 X"、"我盯 X"、"加 X 到我的关注"、"以后多聊聊 X"
用户问 "X 怎么样" 是查询，不算 declared；"我开始研究 X 了" 才算。

### explicit.focus_universe.exclusions
用户明确说出不要碰、不感兴趣的对象。识别信号：
- "不要给我推荐 X"、"我不碰 X"、"X 我不关注"、"把 X 从我的关注里删掉"

## implicit 字段（蒸馏推断区）

基于行为综合判断。

### implicit.focus_universe.active
按对话提及频率排序的关注。frequency_score 范围 0.0-1.0。最多 20 个。

### implicit.risk_tolerance
- conservative: 偏好分红、债券、稳健大盘股
- moderate: 平衡仓位
- aggressive: 高 beta、热门赛道
- speculative: 频繁短线、追逐题材
- null: 不足以判断

### implicit.capability_level
- novice: 基础术语都需要解释
- intermediate: 熟悉常见指标但不深入
- advanced: 熟悉财报、估值模型、技术分析
- professional: 行业 insider，关注微观结构
- null: 不足以判断

### implicit.preferences
- explanation_style: 例如「先结论后分析」、「带数据支撑」
- response_length: 例如「精简」、「详细」
- language: 默认 "中文"
每个字段允许 null。

### implicit.recent_views
用户当前对某个话题的观点（不是规则）。最多 10 条，按时间倒序。

## 处理用户对历史规则的撤销/修改

如果最近消息里说："取消那条 X 规则"、"我改主意了，X 现在可以"、"之前说的 Y 不算了"：
- 从 current_profile 中移除对应的 hard_rule / declared / exclusion
- 不要保留两条互相矛盾的规则

## recent_threads 处理

最近 20 个 user 提问 + agent 立场摘要，按时间倒序。

每条规则：
- user: 完整保留用户问题原文（最多 200 字截断）
- agent_stance: 提取 agent 当时回答里的「建议、承诺、判断」为一句话（≤50 字）
  - agent 仅回答事实数据时，agent_stance 必须为 null（不要把事实当立场）
  - agent 给了建议/判断时，提取简短摘要
- ts: user 提问的时间

# 增量更新原则

- current_profile 是这位用户已有的画像（可能为空骨架）
- new_messages 是自上次蒸馏后的新对话
- 你产出的 profile 必须是「合并后的完整画像」：保留 current_profile 中仍然有效的字段，叠加从 new_messages 提炼出的更新
- 不要因为 new_messages 没提到某个 hard_rule 就删掉它，除非用户明确撤销
- recent_threads 全新生成（不基于 current_recent_threads 增量），从 new_messages + current_recent_threads 中重新挑选最近 20 条 user 提问

# 边界情况

- 如果 new_messages 完全无价值（闲聊、纯查询行情），输出与 current_profile 一致的 profile，仅刷新 recent_threads
- 不要编造没有依据的画像字段（宁可 null）
- ISO 时间戳格式：YYYY-MM-DDTHH:mm:ss.sssZ

# 你不需要做的事

不要写解释、不要 markdown 包裹、不要在 JSON 前后加任何文字。直接输出 JSON 对象本身。`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  user_id: string;
  task_id: string;
  type: string; // 'user' | 'assistant'
  content: string | null;
  created_at: string;
}

interface DistillResult {
  profile: PersonaProfile;
  recent_threads: RecentThread[];
}

export interface DistillStats {
  user_id: string;
  /** 是否实际跑了 LLM（无新消息时跳过） */
  ran: boolean;
  new_messages_count: number;
  duration_ms: number;
  error?: string;
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * 拉取一个用户自 since 以来的新消息，按时间正序。
 */
async function fetchNewMessagesForUser(
  userId: string,
  since: string | null
): Promise<MessageRow[]> {
  const supabase = getServiceSupabase();
  let query = supabase
    .from('messages')
    .select('id, user_id, task_id, type, content, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .in('type', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(MAX_NEW_MESSAGES_PER_RUN);

  if (since) {
    query = query.gt('created_at', since);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch messages for ${userId}: ${error.message}`);
  }
  return (data ?? []) as MessageRow[];
}

/**
 * 拉取当前 persona row（不存在则返回空骨架）。
 */
async function fetchPersonaRow(userId: string): Promise<PersonaMemoryRow> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('persona_memory')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch persona for ${userId}: ${error.message}`);
  }

  if (!data) {
    return {
      user_id: userId,
      profile: EMPTY_PROFILE,
      recent_threads: [],
      last_distilled_at: null,
      updated_at: new Date().toISOString(),
    };
  }

  // 兼容老 row 没有 profile 字段的情况
  return {
    ...data,
    profile: (data.profile as PersonaProfile) ?? EMPTY_PROFILE,
    recent_threads: (data.recent_threads as RecentThread[]) ?? [],
  } as PersonaMemoryRow;
}

/**
 * 把 messages 序列化成 LLM 可消化的对话脚本。
 */
function formatMessagesForLLM(messages: MessageRow[]): string {
  if (messages.length === 0) return '(无新消息)';
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.type === 'user' ? 'USER' : 'AGENT';
    const content = (m.content ?? '').slice(0, 1500); // 防止单条过长
    lines.push(`[${m.created_at}] ${role}: ${content}`);
  }
  return lines.join('\n');
}

/**
 * 调 MiMo 蒸馏，返回新画像 + recent_threads。
 */
async function callDistillLlm(
  currentProfile: PersonaProfile,
  currentRecentThreads: RecentThread[],
  newMessages: MessageRow[]
): Promise<DistillResult> {
  const userPrompt = [
    '## current_profile（这位用户当前已有的画像，从中合并更新）',
    '',
    JSON.stringify(currentProfile, null, 2),
    '',
    '## current_recent_threads（最近 20 个 user 提问的上一版摘要，仅供参考）',
    '',
    JSON.stringify(currentRecentThreads, null, 2),
    '',
    '## new_messages（自上次蒸馏以来的新对话，时间正序）',
    '',
    formatMessagesForLLM(newMessages),
    '',
    '## 任务',
    '',
    '基于以上信息，输出新的 profile + recent_threads JSON。严格按 system prompt 中的 schema。',
  ].join('\n');

  const result = await mimoChatJson<DistillResult>({
    model: DISTILL_MODEL,
    messages: [
      { role: 'system', content: DISTILL_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    timeoutMs: DISTILL_TIMEOUT_MS,
  });

  if (!result.profile || !Array.isArray(result.recent_threads)) {
    throw new Error(
      `Distill LLM returned invalid structure: ${JSON.stringify(result).slice(0, 200)}`
    );
  }

  return {
    profile: result.profile,
    recent_threads: result.recent_threads.slice(0, RECENT_THREADS_LIMIT),
  };
}

/**
 * Upsert 新画像到 persona_memory。
 */
async function writePersona(
  userId: string,
  profile: PersonaProfile,
  recentThreads: RecentThread[],
  distilledAt: string
): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('persona_memory')
    .upsert(
      {
        user_id: userId,
        profile,
        recent_threads: recentThreads,
        last_distilled_at: distilledAt,
        updated_at: distilledAt,
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw new Error(`Failed to upsert persona for ${userId}: ${error.message}`);
  }
}

/**
 * 蒸馏单个用户。无新消息时跳过 LLM 调用，仅返回 stats。
 */
export async function distillUser(userId: string): Promise<DistillStats> {
  const start = Date.now();
  const stats: DistillStats = {
    user_id: userId,
    ran: false,
    new_messages_count: 0,
    duration_ms: 0,
  };

  try {
    const persona = await fetchPersonaRow(userId);
    const newMessages = await fetchNewMessagesForUser(
      userId,
      persona.last_distilled_at
    );
    stats.new_messages_count = newMessages.length;

    if (newMessages.length === 0) {
      // 没新消息，不跑 LLM 也不更新游标
      stats.duration_ms = Date.now() - start;
      return stats;
    }

    const result = await callDistillLlm(
      persona.profile,
      persona.recent_threads,
      newMessages
    );

    // 游标推进到最新一条 message 的 created_at
    const newCursor = newMessages[newMessages.length - 1].created_at;
    await writePersona(userId, result.profile, result.recent_threads, newCursor);

    stats.ran = true;
    stats.duration_ms = Date.now() - start;
    return stats;
  } catch (e) {
    stats.duration_ms = Date.now() - start;
    stats.error =
      e instanceof MimoApiError
        ? `MiMo: ${e.message} [${e.status}]`
        : e instanceof Error
        ? e.message
        : String(e);
    return stats;
  }
}

/**
 * 拉取所有有 messages 的用户列表（去重）。
 * 蒸馏 cron 用此列表逐个调用 distillUser。
 */
async function listAllUsersWithMessages(): Promise<string[]> {
  const supabase = getServiceSupabase();
  // Supabase 不支持原生 distinct，用 RPC 或简单 select + dedup
  // 由于内测期间用户极少，简单 select 即可
  const { data, error } = await supabase
    .from('messages')
    .select('user_id')
    .is('deleted_at', null)
    .limit(10000);

  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  const set = new Set<string>();
  for (const row of (data ?? []) as { user_id: string }[]) {
    if (row.user_id) set.add(row.user_id);
  }
  return Array.from(set);
}

export interface DistillRunSummary {
  total_users: number;
  ran: number;
  skipped: number;
  errors: number;
  total_duration_ms: number;
  per_user: DistillStats[];
}

/**
 * 跑一次完整蒸馏（所有用户）。
 * 按用户串行执行避免 LLM rate limit。
 */
export async function distillAllUsers(): Promise<DistillRunSummary> {
  const start = Date.now();
  const userIds = await listAllUsersWithMessages();

  const summary: DistillRunSummary = {
    total_users: userIds.length,
    ran: 0,
    skipped: 0,
    errors: 0,
    total_duration_ms: 0,
    per_user: [],
  };

  for (const uid of userIds) {
    const stats = await distillUser(uid);
    summary.per_user.push(stats);
    if (stats.error) {
      summary.errors++;
    } else if (stats.ran) {
      summary.ran++;
    } else {
      summary.skipped++;
    }
  }

  summary.total_duration_ms = Date.now() - start;
  return summary;
}
