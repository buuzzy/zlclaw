/**
 * Phase 3 persona_memory schema (前端版本)
 *
 * 与 src-api/src/shared/types/persona-memory.ts 保持镜像同步。
 * 修改这里 = 同时修改后端版本。
 *
 * 字段分层原则（来自决策 6）：
 *   · explicit: 用户主动声明的，蒸馏 prompt 严格按用户原话填
 *   · implicit: 蒸馏综合行为推断的
 *
 * 完整背景：docs/memory/phase3-design.md
 */

export interface HardRule {
  id: string;
  content: string;
  source_quote?: string;
  created_at: string;
}

export interface FocusUniverseDeclared {
  type: 'stock' | 'fund' | 'sector' | 'topic';
  code?: string;
  name: string;
  added_at: string;
}

export interface FocusUniverseExclusion {
  type: 'category' | 'stock' | 'sector';
  value: string;
  reason_quote?: string;
  added_at: string;
}

export interface FocusUniverseActive {
  type: 'stock' | 'fund' | 'sector' | 'topic';
  code?: string;
  name: string;
  frequency_score: number;
}

export interface RecentView {
  topic: string;
  stance: string;
  ts: string;
}

export type RiskTolerance =
  | 'conservative'
  | 'moderate'
  | 'aggressive'
  | 'speculative'
  | null;

export type CapabilityLevel =
  | 'novice'
  | 'intermediate'
  | 'advanced'
  | 'professional'
  | null;

export interface PersonaPreferences {
  explanation_style?: string;
  response_length?: string;
  language?: string;
  [key: string]: string | undefined;
}

export interface PersonaExplicit {
  hard_rules: HardRule[];
  focus_universe: {
    declared: FocusUniverseDeclared[];
    exclusions: FocusUniverseExclusion[];
  };
}

export interface PersonaImplicit {
  focus_universe: {
    active: FocusUniverseActive[];
  };
  risk_tolerance: RiskTolerance;
  capability_level: CapabilityLevel;
  preferences: PersonaPreferences;
  recent_views: RecentView[];
  /** Phase 4 行为摘要（90 天滚动，蒸馏 LLM 综合 user_behavior 写出） */
  behavior_summary?: string | null;
}

export interface PersonaProfile {
  explicit: PersonaExplicit;
  implicit: PersonaImplicit;
}

export interface RecentThread {
  user: string;
  agent_stance: string | null;
  ts: string;
}

export interface PersonaMemoryRow {
  user_id: string;
  profile: PersonaProfile;
  recent_threads: RecentThread[];
  last_distilled_at: string | null;
  updated_at: string;
  content_md?: string;
  consolidated_at?: string | null;
}

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
