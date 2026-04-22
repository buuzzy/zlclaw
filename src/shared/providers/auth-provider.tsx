import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { onOpenUrl, getCurrent as getCurrentDeepLink } from '@tauri-apps/plugin-deep-link';
import { supabase, type Session, type User } from '@/shared/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  status: AuthStatus;
  signInWithGitHub: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * In Tauri desktop the webview cannot receive the OAuth redirect directly.
 * Strategy:
 *   1. Get the OAuth URL from Supabase with skipBrowserRedirect=true
 *   2. Open it in the system browser via tauri-plugin-opener
 *   3. Supabase redirects to sage://auth/callback?code=...
 *   4. OS routes the deep link back to Tauri → Rust emits "sage://auth-callback"
 *   5. We call exchangeCodeForSession(code) to complete the sign-in
 */
async function signInWithProvider(provider: 'github' | 'google') {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: 'sage://auth/callback',
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (data.url) {
    // Open in system browser — Tauri's opener respects macOS/Windows default browser
    await openUrl(data.url);
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    // ── 初始化：获取当前 session，断网兜底 ──────────────────────────────────
    //
    // supabase-js 的 _recoverAndRefresh 在 token 接近过期时会尝试刷新，
    // 断网情况下 _refreshAccessToken 会在 ~30s 后才因超时放弃（配合指数退避）。
    // 这 30s 内 getSession() promise 挂起，AuthGuard 一直转圈。
    //
    // 兜底：两条并行路径——
    //   A. 3s 超时：若 localStorage 有 sb-*-auth-token，先乐观地放行 UI
    //      （setStatus authenticated），用户立即进入主界面
    //   B. 仍然 await getSession()：30s 后真正 resolve 时用它更新 session
    //      对象（补齐 user 信息），若没有 session 就校正为 unauthenticated
    const TIMEOUT_MS = 3000;

    let resolvedByTimeout = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      resolvedByTimeout = true;
      // 从 localStorage 读兜底
      const hasCachedToken = (() => {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
              const raw = localStorage.getItem(key);
              if (raw && raw.includes('access_token')) return true;
            }
          }
        } catch {
          /* ignore */
        }
        return false;
      })();
      console.warn(
        `[Auth] getSession still pending after ${TIMEOUT_MS}ms; using localStorage fallback (cached: ${hasCachedToken})`
      );
      setStatus(hasCachedToken ? 'authenticated' : 'unauthenticated');
    }, TIMEOUT_MS);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeoutId);
      if (cancelled) return;
      // 不管是否已经因超时 setStatus 过，这里都用真实结果再校正一次
      if (resolvedByTimeout) {
        console.log('[Auth] getSession resolved after timeout fallback');
      }
      setSession(session);
      setUser(session?.user ?? null);
      setStatus(session ? 'authenticated' : 'unauthenticated');
    });

    // 监听 Supabase Auth 状态变化（例如 token 刷新、登出）
    // 注意：onAuthStateChange 会在网络恢复 + token 刷新成功后触发 TOKEN_REFRESHED，
    // 补齐超时 fallback 时缺失的 session 对象。
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setStatus(session ? 'authenticated' : 'unauthenticated');
    });

    // Deep link 回调处理：从 sage://auth/callback?code=... 中提取 code 并交换 session
    const handleDeepLinkUrls = async (urls: string[]) => {
      for (const callbackUrl of urls) {
        console.log('[Auth] Deep link received:', callbackUrl);
        try {
          const url = new URL(callbackUrl);
          const code = url.searchParams.get('code');
          console.log(
            '[Auth] Extracted code:',
            code ? code.slice(0, 8) + '...' : 'null'
          );

          if (code) {
            const { data, error } =
              await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              console.error(
                '[Auth] exchangeCodeForSession failed:',
                error.message
              );
            } else {
              console.log('[Auth] Session established for:', data.user?.email);
            }
            // onAuthStateChange 会自动更新 user/session/status
          } else {
            console.warn('[Auth] No code param in deep link URL:', callbackUrl);
          }
        } catch (err) {
          console.error('[Auth] Error processing deep link callback:', err);
        }
      }
    };

    // Cold-start: app 被 deep link 唤醒时的初始 URL
    getCurrentDeepLink()
      .then((urls) => {
        if (urls && urls.length > 0) {
          console.log('[Auth] Cold-start deep link:', urls);
          void handleDeepLinkUrls(urls);
        }
      })
      .catch((err) => console.error('[Auth] getCurrent failed:', err));

    // Warm-start: app 已在运行时接收到新的 deep link
    let unlisten: (() => void) | undefined;
    onOpenUrl((urls) => {
      console.log('[Auth] Warm-start deep link:', urls);
      void handleDeepLinkUrls(urls);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => console.error('[Auth] onOpenUrl register failed:', err));

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
      unlisten?.();
    };
  }, []);

  const signInWithGitHub = useCallback(async () => {
    await signInWithProvider('github');
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithProvider('google');
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, session, status, signInWithGitHub, signInWithGoogle, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
