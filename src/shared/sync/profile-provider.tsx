/**
 * ProfileProvider — Phase 1 of cloud sync
 *
 * 前提：用户必须已登录（AuthGuard 保证进入主应用时 status === 'authenticated'）。
 * 本 Provider 挂在 AuthProvider 之下，对外暴露：
 *   • profile: 云端 public.profiles 的当前快照（登录后一定非 null）
 *   • isLoading: 是否正在首次拉取
 *   • update(patch): 乐观更新 + upsert 云端
 *   • refresh(): 手动重新拉取
 *
 * 登录态变化时：
 *   • authenticated → fetchProfile，若缺则 upsert 建档，并上报 app_version / platform
 *   • unauthenticated → 清空 profile（登录页等非主应用场景使用）
 *
 * 防闪烁缓存：
 *   成功拉取到的 profile 按 user.id 缓存到 localStorage。
 *   下次启动 / 重登时立刻用缓存作为初始值，同时静默 fetch 校对。
 *   这样用户不会先看到 GitHub/Google 原名再切换成自定义昵称。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/shared/providers/auth-provider';
import { supabase } from '@/shared/lib/supabase';
import {
  deriveFallbackFromUser,
  syncProfileOnLogin,
  upsertProfile,
  type CloudProfile,
  type ProfileUpdate,
} from './profile-sync';
import { markFailed, markOk, markSyncing, registerRetryHandler } from './sync-status';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProfileContextType {
  /** 云端 profile 快照，未登录或首次加载完成前为 null */
  profile: CloudProfile | null;
  /** 是否正在首次同步（登录后的 fetch+possibly upsert） */
  isLoading: boolean;
  /** 修改 profile 字段。乐观更新 + 失败时回滚并抛错 */
  update: (patch: ProfileUpdate) => Promise<void>;
  /** 手动重新拉取云端 profile */
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// ─── Env helpers ─────────────────────────────────────────────────────────────

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

const ENV_INFO = {
  app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
  platform: detectPlatform(),
};

// ─── LocalStorage cache（防闪烁） ─────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'sage:profile-cache:';

function cacheKey(userId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}`;
}

function readCachedProfile(userId: string): CloudProfile | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudProfile;
    // 防御性：确认 id 匹配（避免缓存被篡改或 schema 漂移）
    if (parsed && parsed.id === userId) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: CloudProfile): void {
  try {
    localStorage.setItem(cacheKey(profile.id), JSON.stringify(profile));
  } catch (err) {
    console.warn('[ProfileProvider] cache write failed:', err);
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 登录态变化 → 先用缓存 hydrate，再静默拉取云端校对；同时订阅 realtime
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (status !== 'authenticated' || !user) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      // 1) Hydrate from cache — 立刻显示上次看到的昵称/头像，避免 0.5s 闪烁
      const cached = readCachedProfile(user.id);
      if (cached) {
        setProfile(cached);
        setIsLoading(false); // 视觉上已经"就绪"，后台继续校对
      } else {
        setIsLoading(true);
      }

      // 2) 静默同步云端并校对
      markSyncing('profile');
      try {
        const synced = await syncProfileOnLogin(user, ENV_INFO);
        if (cancelled) return;
        if (synced) {
          setProfile(synced);
          writeCachedProfile(synced);
        }
        markOk('profile');
      } catch (err) {
        console.error('[ProfileProvider] syncProfileOnLogin failed:', err);
        markFailed('profile', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();

    // 3) 订阅 Realtime：其他设备改了 profile → 立刻反映到本地
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (status === 'authenticated' && user) {
      channel = supabase
        .channel(`profile:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as CloudProfile;
            console.log('[ProfileProvider] realtime update:', next);
            setProfile(next);
            writeCachedProfile(next);
          }
        )
        .subscribe();
    }

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [status, user]);

  const refresh = useCallback(async () => {
    if (status !== 'authenticated' || !user) return;
    setIsLoading(true);
    markSyncing('profile');
    try {
      const synced = await syncProfileOnLogin(user, ENV_INFO);
      if (synced) {
        setProfile(synced);
        writeCachedProfile(synced);
      }
      markOk('profile');
    } catch (err) {
      console.error('[ProfileProvider] refresh failed:', err);
      markFailed('profile', err);
    } finally {
      setIsLoading(false);
    }
  }, [status, user]);

  // 注册 retry 入口：网络恢复 / 用户手动重试时 sync-status 会回调这里
  useEffect(() => {
    return registerRetryHandler('profile', () => refresh());
  }, [refresh]);

  const update = useCallback(
    async (patch: ProfileUpdate) => {
      if (status !== 'authenticated' || !user) {
        throw new Error('Not authenticated');
      }

      // 乐观更新
      const previous = profile;
      setProfile((p) => (p ? { ...p, ...patch } : p));

      markSyncing('profile');
      try {
        const updated = await upsertProfile(user.id, patch);
        setProfile(updated);
        writeCachedProfile(updated);
        markOk('profile');
      } catch (err) {
        // 回滚
        setProfile(previous);
        console.error('[ProfileProvider] update failed:', err);
        markFailed('profile', err);
        throw err;
      }
    },
    [status, user, profile]
  );

  return (
    <ProfileContext.Provider value={{ profile, isLoading, update, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}

/**
 * 便捷 hook：返回用于 UI 展示的 { displayName, avatarUrl }。
 *
 * 用户已登录是前提（AuthGuard 保证）。优先顺序：
 *   cloud profile（含 localStorage 缓存）→ auth user_metadata → "Guest User"
 *
 * 调用方式：
 *   const { displayName, avatarUrl } = useDisplayIdentity();
 */
export function useDisplayIdentity(): {
  displayName: string;
  avatarUrl: string;
} {
  const { profile } = useProfile();
  const { user } = useAuth();

  const authFallback = deriveFallbackFromUser(user);
  return {
    displayName:
      profile?.display_name || authFallback.display_name || 'Guest User',
    avatarUrl: profile?.avatar_url || authFallback.avatar_url || '',
  };
}
