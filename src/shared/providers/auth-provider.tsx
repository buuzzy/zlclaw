import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { supabase, type Session, type User } from '@/shared/lib/supabase';
import { bindUserId, unbindUser } from '@/shared/db/database';
import { reloadSettingsForCurrentUser } from '@/shared/db/settings';

const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Types ───────────────────────────────────────────────────────────────────

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  status: AuthStatus;
  /**
   * 本地 user-scoped DB 是否已绑定成功。
   * - `status === 'authenticated'` 只意味着云端 session 在（或离线缓存在），
   * - `dbReady === true` 才代表本地 SQLite 已经切到该账号的 ~/.sage/users/{uid}/sage.db
   *   并完成幂等建表 / legacy 数据迁移。
   * - 业务页（session 列表、settings）应等 dbReady 再做查询，避免切账号瞬间读到残影。
   */
  dbReady: boolean;
  signInWithGitHub: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Two OAuth strategies:
 *
 * Tauri desktop:
 *   1. skipBrowserRedirect=true → get OAuth URL
 *   2. Open in system browser via tauri-plugin-opener
 *   3. Deep link sage://auth/callback?code=... routes back to app
 *   4. exchangeCodeForSession(code) completes sign-in
 *
 * iOS / Web (Capacitor, browser):
 *   1. skipBrowserRedirect=false (default) → Supabase handles redirect
 *   2. OAuth completes in-page, Supabase JS auto-detects session from URL hash
 *   3. onAuthStateChange fires with the new session
 */
async function signInWithProvider(provider: 'github' | 'google') {
  if (isTauri) {
    // Desktop: open system browser → OAuth → deep link back to app.
    // Primary redirect: sage:// deep link fires directly.
    // Fallback: if browser can't handle sage://, Supabase falls back to
    // Site URL (configured as Railway /auth/callback) which renders a
    // success page and triggers the deep link via JS.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: 'sage://auth/callback',
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (data.url) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(data.url);
    }
  } else {
    // iOS / Web: in-page redirect, Supabase handles everything
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  }
}

/**
 * 从 localStorage 里 Supabase 缓存的 session token 中解析出 user.id。
 * 用于断网启动兜底：`supabase.auth.getSession()` 因 token 刷新卡住时，
 * 我们依然能把 UI 放行并绑定正确的本地 DB。
 *
 * 存储形态：`sb-<ref>-auth-token` = JSON，内含 `access_token` (JWT)。
 * JWT payload 里有 `sub` = user uuid。
 */
function parseUidFromLocalSession(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      // Supabase v2 形态：{ access_token, refresh_token, user: { id }, ... }
      // 优先直接取 user.id（最可靠），失败再 fallback 到解 JWT。
      const userId = (parsed as { user?: { id?: string } })?.user?.id;
      if (typeof userId === 'string' && userId.length > 0) {
        return userId;
      }

      const token = (parsed as { access_token?: string })?.access_token;
      if (typeof token === 'string') {
        const parts = token.split('.');
        if (parts.length === 3) {
          try {
            // base64url → base64 → JSON
            const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
            const payload = JSON.parse(atob(b64 + pad));
            if (typeof payload.sub === 'string') return payload.sub;
          } catch {
            /* fall through */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 每次 bindUserId 的调用都是串行的（database.ts 内部有 inFlight lock），
    // 这里的 lastBoundUid 只用来避免相同 uid 重复 bind 带来的 schema 检查噪音。
    let lastBoundUid: string | null = null;

    /**
     * 中心化"切换到 uid X"。
     *   - uid === null → unbindUser()，dbReady = false
     *   - uid !== null 且 === lastBoundUid → no-op（相同账号的 TOKEN_REFRESHED 等）
     *   - uid !== null 且不同 → 切换连接，成功后 dbReady = true
     */
    const switchDbTo = async (uid: string | null) => {
      if (uid === lastBoundUid && uid !== null) return;

      if (uid === null) {
        lastBoundUid = null;
        try {
          await unbindUser();
        } catch (err) {
          console.error('[Auth] unbindUser failed:', err);
        }
        if (!cancelled) setDbReady(false);
        return;
      }

      try {
        await bindUserId(uid);
        // Settings 走的是同一份 user-scoped DB —— 切换账号后强制重载一次，
        // 避免拿到上一位用户的主题/语言等缓存。
        await reloadSettingsForCurrentUser();
        lastBoundUid = uid;
        if (!cancelled) setDbReady(true);
      } catch (err) {
        console.error('[Auth] bindUserId failed:', err);
        if (!cancelled) setDbReady(false);
      }
    };

    // ── 初始化：获取当前 session，断网兜底 ──────────────────────────────────
    //
    // supabase-js 的 _recoverAndRefresh 在 token 接近过期时会尝试刷新，
    // 断网情况下 _refreshAccessToken 会在 ~30s 后才因超时放弃（配合指数退避）。
    // 这 30s 内 getSession() promise 挂起，AuthGuard 一直转圈。
    //
    // 兜底：两条并行路径——
    //   A. 3s 超时：若 localStorage 有 sb-*-auth-token，解析 user.id 后立即
    //      bindUserId → 乐观放行 UI
    //   B. 仍然 await getSession()：30s 后真正 resolve 时用它更新 session
    //      对象（补齐 user 信息），若 uid 与超时路径一致则保持 dbReady；
    //      若为空则校正为 unauthenticated 并 unbindUser
    const TIMEOUT_MS = 3000;

    let resolvedByTimeout = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      resolvedByTimeout = true;
      const cachedUid = parseUidFromLocalSession();
      console.warn(
        `[Auth] getSession still pending after ${TIMEOUT_MS}ms; using localStorage fallback (uid: ${
          cachedUid ? cachedUid.slice(0, 8) + '…' : 'none'
        })`
      );
      if (cachedUid) {
        void switchDbTo(cachedUid);
        setStatus('authenticated');
      } else {
        setStatus('unauthenticated');
      }
    }, TIMEOUT_MS);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeoutId);
      if (cancelled) return;
      if (resolvedByTimeout) {
        console.log('[Auth] getSession resolved after timeout fallback');
      }
      setSession(session);
      setUser(session?.user ?? null);
      setStatus(session ? 'authenticated' : 'unauthenticated');
      void switchDbTo(session?.user?.id ?? null);
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
      void switchDbTo(session?.user?.id ?? null);
    });

    // Deep link 回调处理（仅 Tauri 桌面端）
    let unlisten: (() => void) | undefined;

    if (isTauri) {
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
      import('@tauri-apps/plugin-deep-link').then(({ getCurrent: getCurrentDeepLink }) => {
        getCurrentDeepLink()
          .then((urls) => {
            if (urls && urls.length > 0) {
              console.log('[Auth] Cold-start deep link:', urls);
              void handleDeepLinkUrls(urls);
            }
          })
          .catch((err: unknown) => console.error('[Auth] getCurrent failed:', err));
      }).catch(() => {});

      // Warm-start: app 已在运行时接收到新的 deep link
      import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        onOpenUrl((urls) => {
          console.log('[Auth] Warm-start deep link:', urls);
          void handleDeepLinkUrls(urls);
        })
          .then((fn) => {
            unlisten = fn;
          })
          .catch((err: unknown) => console.error('[Auth] onOpenUrl register failed:', err));
      }).catch(() => {});
    }

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

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // onAuthStateChange('SIGNED_OUT') 会触发 switchDbTo(null)
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        status,
        dbReady,
        signInWithGitHub,
        signInWithGoogle,
        signInWithEmail,
        signOut,
      }}
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
