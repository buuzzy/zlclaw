import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wymqgwtagpsjuonsclye.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5bXFnd3RhZ3BzanVvbnNjbHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NTczNjEsImV4cCI6MjA5MjMzMzM2MX0.2MmvzN_EJYBtAZdcny8fqs9K5UoBLE8KsXU1NEwH94U';

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
