/**
 * Profile Sync — Phase 1 of cloud sync
 *
 * 数据源：public.profiles（Supabase）
 *
 * 职责：
 *   • 登录后读取云端 profile 并作为 UI 昵称/头像权威来源
 *   • 提供 updateProfile() 用于 Account Settings 写入云端
 *   • 若云端 profile 不存在（理论上 handle_new_user trigger 会自动建档，
 *     但 fallback 到前端 upsert 保险）
 *
 * 非职责：
 *   • 不处理离线队列（Phase 1 keep it simple，失败只记 console.error）
 *   • 不监听 realtime 变化（Phase 5 再做）
 */

import { supabase, type User } from '@/shared/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloudProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  app_version: string | null;
  platform: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdate {
  display_name?: string | null;
  avatar_url?: string | null;
  app_version?: string | null;
  platform?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 从 Supabase Auth user 的 metadata 提取 display_name / avatar fallback。
 * GitHub: full_name / name / user_name + avatar_url
 * Google: full_name / name + avatar_url / picture
 */
export function deriveFallbackFromUser(
  user: User | null
): { display_name: string | null; avatar_url: string | null } {
  if (!user) return { display_name: null, avatar_url: null };
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const display_name =
    (meta.full_name as string) ||
    (meta.name as string) ||
    (meta.user_name as string) ||
    (user.email ? user.email.split('@')[0] : null) ||
    null;
  const avatar_url =
    (meta.avatar_url as string) || (meta.picture as string) || null;
  return { display_name, avatar_url };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * 从云端读取当前登录用户的 profile。
 *
 * 返回语义：
 *   • CloudProfile — 正常读到记录
 *   • null         — 查询成功但云端无记录（首次登录 trigger 未建档）
 *   • throw        — 网络 / RLS / Supabase 错误（上层用来区分"失败"）
 */
export async function fetchProfile(
  userId: string
): Promise<CloudProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // 真正的失败：网络 / RLS / schema。交给上层捕获，UI 状态走 failed。
    throw new Error(`[profile-sync] fetchProfile: ${error.message}`);
  }
  return data as CloudProfile | null;
}

/**
 * UPSERT profile 到云端。
 * 失败抛出（上层用 try/catch 判定，决定是否 markFailed）。
 *
 * 注意：RLS 保证只能写自己的 row（auth.uid() = id）。
 */
export async function upsertProfile(
  userId: string,
  patch: ProfileUpdate
): Promise<CloudProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        ...patch,
      },
      { onConflict: 'id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`[profile-sync] upsertProfile: ${error.message}`);
  }
  if (!data) {
    throw new Error('[profile-sync] upsertProfile: no row returned');
  }
  return data as CloudProfile;
}

/**
 * 登录后的一次性同步：
 *   1. 拉云端 profile
 *   2. 若不存在，用 auth metadata 建档
 *   3. 若存在但缺少字段（例如老用户升级后补 platform），补齐
 *   4. 始终把 app_version + platform 上报一次（轻量）
 */
export async function syncProfileOnLogin(
  user: User,
  envInfo: { app_version: string; platform: string }
): Promise<CloudProfile | null> {
  let cloud = await fetchProfile(user.id);
  const fallback = deriveFallbackFromUser(user);

  if (!cloud) {
    // Trigger 理论上已经建档，走到这里说明 trigger 失败或被禁。主动 upsert 兜底。
    console.log('[profile-sync] No cloud profile, creating from auth metadata');
    cloud = await upsertProfile(user.id, {
      display_name: fallback.display_name,
      avatar_url: fallback.avatar_url,
      app_version: envInfo.app_version,
      platform: envInfo.platform,
    });
    return cloud;
  }

  // 已有 cloud profile。补齐空字段 + 更新环境信息。
  const patch: ProfileUpdate = {};
  let needsUpdate = false;
  if (!cloud.display_name && fallback.display_name) {
    patch.display_name = fallback.display_name;
    needsUpdate = true;
  }
  if (!cloud.avatar_url && fallback.avatar_url) {
    patch.avatar_url = fallback.avatar_url;
    needsUpdate = true;
  }
  if (cloud.app_version !== envInfo.app_version) {
    patch.app_version = envInfo.app_version;
    needsUpdate = true;
  }
  if (cloud.platform !== envInfo.platform) {
    patch.platform = envInfo.platform;
    needsUpdate = true;
  }

  if (needsUpdate) {
    const updated = await upsertProfile(user.id, patch);
    if (updated) return updated;
  }
  return cloud;
}
