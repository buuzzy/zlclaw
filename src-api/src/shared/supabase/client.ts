/**
 * Supabase Client (server-side, service_role)
 *
 * 用途：sage-api 后端访问 Supabase（绕过 RLS）。
 * 仅用于「服务端代用户做事」场景，必须显式带 user_id 过滤。
 *
 * 环境变量来源：
 *   - 桌面端：Tauri sidecar 启动时从 `~/.sage/.env` 注入
 *   - Railway：在 Railway 控制台环境变量配置
 *
 * 安全：service_role key 拥有数据库完全权限，**绝不能**返回给前端。
 *      只在后端进程内部使用。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * 返回懒初始化的 service-role Supabase client。
 * 第一次访问时检查环境变量，缺失则抛错。
 */
export function getServiceSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      '[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. ' +
        'Set them in ~/.sage/.env (desktop) or Railway env (cloud).'
    );
  }

  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log('[supabase] service_role client initialized');
  return cached;
}

/**
 * 检查 supabase 是否已配置（不抛错，仅返回 boolean）。
 * 用于条件性启用云端功能（如 search_memory）。
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
