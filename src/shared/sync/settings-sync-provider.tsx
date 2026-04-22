/**
 * SettingsSyncProvider — Phase 2 + Phase 5 realtime
 *
 * 前提：用户必须已登录（挂在 ProfileProvider 下）。
 *
 * 职责：
 *   1. 登录后（status 变成 authenticated）从云端拉取白名单设置，merge 到本地 Settings
 *      并通过 saveSettings() 让整个 UI 响应（theme/language provider 等）
 *   2. 订阅本地 settings 保存事件，debounced 把白名单子集 push 到云端
 *   3. Phase 5：订阅 Supabase Realtime，其他设备改了 user_settings 时立刻 merge
 *
 * 冲突策略：LWW — 登录时云端覆盖本地白名单字段（假设云端更"新"）。
 * 第一次登录如果云端无记录，则把本地白名单 push 上去建档。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from '@/shared/providers/auth-provider';
import { supabase } from '@/shared/lib/supabase';
import {
  getSettings,
  saveSettings,
  subscribeSettingsSaved,
  type Settings,
} from '@/shared/db/settings';
import {
  extractSyncable,
  fetchCloudSettings,
  mergeCloudIntoLocal,
  pushCloudSettings,
  syncableEqual,
  type SyncablePartial,
} from './settings-sync';
import { markFailed, markOk, markSyncing, registerRetryHandler } from './sync-status';

const PUSH_DEBOUNCE_MS = 1000;

export function SettingsSyncProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();

  // 记录云端当前已知快照，用于比较是否真的需要 push
  const lastPushedRef = useRef<SyncablePartial | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydratingRef = useRef(false);

  // 暴露最新的 hydrate 函数给 retry handler（handler 本身不变，内部永远看到最新的闭包）
  const hydrateRef = useRef<() => Promise<void>>(async () => {});

  // ── 登录时：fetch 云端 → merge 到本地 → 若云端无记录则 push 建档 ───────────
  // 同时订阅 Realtime：其他设备改了 user_settings 时立刻 merge 到本地
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (status !== 'authenticated' || !user) {
        lastPushedRef.current = null;
        return;
      }

      isHydratingRef.current = true;
      markSyncing('settings');
      try {
        const cloud = await fetchCloudSettings(user.id);
        if (cancelled) return;

        const local = getSettings();
        if (cloud) {
          // 云端存在 → 覆盖本地白名单字段
          const merged: Settings = mergeCloudIntoLocal(local, cloud);
          // 仅在真正不一致时调用 saveSettings，避免无意义地触发观察者
          if (!syncableEqual(extractSyncable(local), cloud)) {
            saveSettings(merged);
          }
          lastPushedRef.current = cloud;
          console.log('[settings-sync] Hydrated from cloud:', cloud);
        } else {
          // 云端无记录 → push 本地白名单建档
          const partial = extractSyncable(local);
          await pushCloudSettings(user.id, partial);
          lastPushedRef.current = partial;
          console.log('[settings-sync] Created cloud record from local');
        }
        markOk('settings');
      } catch (err) {
        console.error('[settings-sync] hydrate failed:', err);
        markFailed('settings', err);
      } finally {
        if (!cancelled) isHydratingRef.current = false;
      }
    };

    // 让 retry handler 永远能调到最新的 hydrate（它闭包了最新的 user/status）
    hydrateRef.current = hydrate;

    void hydrate();

    // Realtime 订阅
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (status === 'authenticated' && user) {
      channel = supabase
        .channel(`user_settings:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT / UPDATE
            schema: 'public',
            table: 'user_settings',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as { settings?: SyncablePartial };
            const next = row?.settings;
            if (!next) return;

            // 若和本地已知快照一致，跳过（比如我们刚 push 的回声）
            if (
              lastPushedRef.current &&
              syncableEqual(lastPushedRef.current, next)
            ) {
              return;
            }

            console.log('[settings-sync] realtime update:', next);
            const local = getSettings();
            const merged = mergeCloudIntoLocal(local, next);

            // 暂时打开 hydrating 标记，避免 saveSettings 触发回推观察者
            isHydratingRef.current = true;
            try {
              saveSettings(merged);
              lastPushedRef.current = next;
            } finally {
              // 下一 tick 关闭，让 settings observers 下次生效
              setTimeout(() => {
                isHydratingRef.current = false;
              }, 0);
            }
          }
        )
        .subscribe();
    }

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [status, user]);

  // ── 本地 saveSettings → debounced push ────────────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;

    const unsubscribe = subscribeSettingsSaved((settings) => {
      // hydrate 阶段 / realtime 合并时 saveSettings 是我们自己调的，避免 bounce
      if (isHydratingRef.current) return;

      const partial = extractSyncable(settings);

      // 若和上次已推送的快照一致，什么都不做
      if (
        lastPushedRef.current &&
        syncableEqual(lastPushedRef.current, partial)
      ) {
        return;
      }

      // Debounce
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(async () => {
        pushTimerRef.current = null;
        markSyncing('settings');
        try {
          await pushCloudSettings(user.id, partial);
          lastPushedRef.current = partial;
          console.log('[settings-sync] Pushed to cloud');
          markOk('settings');
        } catch (err) {
          console.error('[settings-sync] push failed:', err);
          markFailed('settings', err);
        }
      }, PUSH_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [status, user]);

  // 注册 retry 入口（挂一次就够，内部通过 ref 拿到最新的 hydrate）
  useEffect(() => {
    return registerRetryHandler('settings', () => hydrateRef.current());
  }, []);

  return <>{children}</>;
}
