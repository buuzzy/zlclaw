import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client
 *
 * URL / anon key 来自 Vite 环境变量，在打包时被 define 替换：
 *   - `pnpm tauri dev` → configs/env/.env.development (或默认 fallback 到 prod)
 *   - `pnpm tauri build` → configs/env/.env.production
 *
 * 为什么 anon key 可以公开：
 *   它只授予"匿名访问"（由 RLS 政策限制），不是 service_role key。
 *   参考：https://supabase.com/docs/guides/api/api-keys
 *
 * 首次内测期建议：
 *   1. 在 Supabase dashboard 建一个独立的 `sage-dev` project
 *   2. 把 schema 同步（`supabase db push` 或手动跑 migration）
 *   3. 把 dev project 的 URL / anon key 填到 configs/env/.env.development
 *   4. prod project 的保持在 configs/env/.env.production（即当前硬编码的老值作为兜底）
 */

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://wymqgwtagpsjuonsclye.supabase.co';

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5bXFnd3RhZ3BzanVvbnNjbHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NTczNjEsImV4cCI6MjA5MjMzMzM2MX0.2MmvzN_EJYBtAZdcny8fqs9K5UoBLE8KsXU1NEwH94U';

/**
 * 提供给诊断 UI 使用的元数据（如 AboutSettings 底部显示当前环境）。
 * `env` 通过 MODE 判断：dev build = 'dev'，release build = 'prod'，其他视为 'other'。
 */
export const supabaseMeta = {
  url: SUPABASE_URL,
  env: import.meta.env.DEV
    ? ('dev' as const)
    : import.meta.env.PROD
      ? ('prod' as const)
      : ('other' as const),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // 桌面端通过 deep link 手动处理 callback，无需 URL 检测
    detectSessionInUrl: false,
    // PKCE flow：exchangeCodeForSession 需要 flowType = 'pkce'
    flowType: 'pkce',
  },
});

export type { User, Session } from '@supabase/supabase-js';
