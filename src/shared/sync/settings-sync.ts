/**
 * Settings Sync — Phase 2 of cloud sync
 *
 * 数据源：public.user_settings（Supabase，JSONB）
 *
 * 职责：
 *   • 拉取云端偏好快照
 *   • 把本地偏好 upsert 到云端（debounced，白名单字段）
 *   • 合并策略：登录时云端覆盖本地白名单字段，本地独有字段保留
 *
 * 白名单原则（见 SYNCABLE_KEYS）：
 *   ✅ 跨设备有价值且不敏感的字段
 *   ❌ API Key、设备本地路径、providers[] / agentRuntimes[] 等含敏感配置的数组
 *
 * 非职责：
 *   • 不处理离线队列（Phase 5 增强）
 *   • 不订阅 realtime（Phase 5 增强）
 */

import { supabase } from '@/shared/lib/supabase';
import type { Settings } from '@/shared/db/settings';

// ─── White-listed keys（只有这些字段会上云） ──────────────────────────────────
//
// ⚠️ 新增 Settings 字段时，请主动判断是否要加入白名单。
// 默认**不加入**（宁可漏，不可泄漏）。

export const SYNCABLE_KEYS = [
  // 主题 / 外观
  'theme',
  'accentColor',
  'backgroundStyle',
  // 语言
  'language',
  // AI 选择（只存 id / name，API Key 在 providers[] 里不上云）
  'defaultProvider',
  'defaultModel',
  'defaultSandboxProvider',
  'defaultAgentRuntime',
  // 行为上限
  'maxConversationTurns',
  'maxHistoryTokens',
  // 能力开关
  'mcpEnabled',
  'mcpUserDirEnabled',
  'mcpAppDirEnabled',
  'skillsEnabled',
  'skillsUserDirEnabled',
  'skillsAppDirEnabled',
  'sandboxEnabled',
] as const satisfies readonly (keyof Settings)[];

export type SyncableKey = (typeof SYNCABLE_KEYS)[number];

export type SyncablePartial = {
  [K in SyncableKey]?: Settings[K];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 从完整 Settings 里提取白名单子集 */
export function extractSyncable(settings: Settings): SyncablePartial {
  const out: SyncablePartial = {};
  for (const key of SYNCABLE_KEYS) {
    // @ts-expect-error 逐键拷贝白名单
    out[key] = settings[key];
  }
  return out;
}

/** 把云端子集合并到本地 Settings（云端字段覆盖本地同名字段，本地独有字段保留） */
export function mergeCloudIntoLocal(
  local: Settings,
  cloud: SyncablePartial
): Settings {
  return { ...local, ...cloud };
}

/** 浅比较两个 SyncablePartial 是否字段一致（避免无意义的 push） */
export function syncableEqual(
  a: SyncablePartial,
  b: SyncablePartial
): boolean {
  for (const key of SYNCABLE_KEYS) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * 拉取云端 user_settings。
 *
 * 返回语义：
 *   • SyncablePartial — 云端有记录
 *   • null            — 查询成功但云端无记录（首次登录）
 *   • throw           — 网络 / Supabase 错误
 */
export async function fetchCloudSettings(
  userId: string
): Promise<SyncablePartial | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`[settings-sync] fetchCloudSettings: ${error.message}`);
  }
  if (!data) return null;

  // data.settings 是 JSONB，直接返回（运行时可能包含未知字段，consumer 按 key 白名单过滤即可）
  return data.settings as SyncablePartial;
}

/**
 * UPSERT 本地白名单子集到云端。
 * 使用 user_id 作为冲突键（表上有 UNIQUE(user_id) 约束）。
 *
 * 失败抛出。
 */
export async function pushCloudSettings(
  userId: string,
  partial: SyncablePartial
): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .upsert(
      {
        user_id: userId,
        settings: partial,
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw new Error(`[settings-sync] pushCloudSettings: ${error.message}`);
  }
}
