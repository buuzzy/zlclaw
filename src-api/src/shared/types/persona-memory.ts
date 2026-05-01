/**
 * Phase 3 persona_memory schema (服务端版本)
 *
 * 与 src/shared/types/persona-memory.ts 保持镜像同步。
 * 修改这里 = 同时修改前端版本。
 *
 * 字段分层原则（来自决策 6）：
 *   · explicit: 用户主动声明的，蒸馏 prompt 严格按用户原话填
 *   · implicit: 蒸馏综合行为推断的
 *
 * 完整背景：docs/memory/phase3-design.md
 */

/** 一条用户立的硬规则 */
export interface HardRule {
  id: string;
  content: string;
  /** 用户原话引用（可选，用于回溯） */
  source_quote?: string;
  created_at: string;
}

/** 用户主动声明加入关注的标的/主题 */
export interface FocusUniverseDeclared {
  type: 'stock' | 'fund' | 'sector' | 'topic';
  code?: string;
  name: string;
  added_at: string;
}

/** 用户主动声明排除的对象 */
export interface FocusUniverseExclusion {
  type: 'category' | 'stock' | 'sector';
  value: string;
  /** 用户当时的原话（可选） */
  reason_quote?: string;
  added_at: string;
}

/** 蒸馏推断的活跃关注（按对话频率） */
export interface FocusUniverseActive {
  type: 'stock' | 'fund' | 'sector' | 'topic';
  code?: string;
  name: string;
  /** 0-1 范围的频率分数 */
  frequency_score: number;
}

/** 蒸馏推断的近期观点 */
export interface RecentView {
  topic: string;
  /** 用户的立场摘要 */
  stance: string;
  ts: string;
}

/** 风险偏好枚举 */
export type RiskTolerance =
  | 'conservative'
  | 'moderate'
  | 'aggressive'
  | 'speculative'
  | null;

/** 能力水平枚举 */
export type CapabilityLevel =
  | 'novice'
  | 'intermediate'
  | 'advanced'
  | 'professional'
  | null;

/** 沟通偏好（开放结构） */
export interface PersonaPreferences {
  /** 解释风格：先结论后分析 / 先分析后结论 / 仅结论 等 */
  explanation_style?: string;
  /** 回应详略：精简 / 中等 / 详细 */
  response_length?: string;
  /** 偏好语言（默认中文） */
  language?: string;
  [key: string]: string | undefined;
}

/** 显式字段集（用户主动声明，由蒸馏严格按原话填） */
export interface PersonaExplicit {
  hard_rules: HardRule[];
  focus_universe: {
    declared: FocusUniverseDeclared[];
    exclusions: FocusUniverseExclusion[];
  };
}

/** 隐式字段集（蒸馏综合推断） */
export interface PersonaImplicit {
  focus_universe: {
    active: FocusUniverseActive[];
  };
  risk_tolerance: RiskTolerance;
  capability_level: CapabilityLevel;
  preferences: PersonaPreferences;
  recent_views: RecentView[];
  /**
   * Phase 4 / L4-light 行为摘要：蒸馏 cron 从 user_behavior 表 90 天滚动
   * 数据中聚合出的「最近这位用户在做什么」一段话。例如：
   *   "最近 30 天高频问消费板块（茅台/泸州老窖），偶尔触科技（英伟达），
   *    几乎不再问医药；周末提问频率明显高于工作日。"
   * 由蒸馏 LLM 综合 behavior_stats 自然语言写出，最多 500 字。
   * null = 数据不足或刚启用，不渲染到 system prompt。
   */
  behavior_summary?: string | null;
}

/** 完整 profile JSONB schema */
export interface PersonaProfile {
  explicit: PersonaExplicit;
  implicit: PersonaImplicit;
}

/** recent_threads 单条 */
export interface RecentThread {
  user: string;
  /** agent 立场摘要：建议/承诺/判断的一句话提取；如 agent 仅回答事实则为 null */
  agent_stance: string | null;
  ts: string;
}

/** persona_memory 表的完整 row（Phase 3 schema） */
export interface PersonaMemoryRow {
  user_id: string;
  profile: PersonaProfile;
  recent_threads: RecentThread[];
  last_distilled_at: string | null;
  updated_at: string;
  /** Deprecated v1.2.x 字段，Phase 3 不再写入 */
  content_md?: string;
  /** Deprecated v1.2.x 字段，被 last_distilled_at 取代 */
  consolidated_at?: string | null;
}

/** 空 profile 骨架（新用户兜底） */
export const EMPTY_PROFILE: PersonaProfile = {
  explicit: {
    hard_rules: [],
    focus_universe: {
      declared: [],
      exclusions: [],
    },
  },
  implicit: {
    focus_universe: { active: [] },
    risk_tolerance: null,
    capability_level: null,
    preferences: {},
    recent_views: [],
    behavior_summary: null,
  },
};
