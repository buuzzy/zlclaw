/**
 * SessionSyncProvider — Phase 3 of cloud sync (最小闭环版)
 *
 * 前提：用户必须已登录（挂在 ProfileProvider 下）。
 *
 * 职责：
 *   1. 登录后 fetch 云端所有 session（供将来 UI 使用；本版仅打印日志 + 暂存）
 *   2. 订阅 dirty queue，debounced 把本地变更 flush 到云端
 *   3. 退出登录时清理订阅
 *
 * 冲突策略：不 merge 云端到本地（Phase 3 最小闭环不做）。
 * 如果本地没有 session 但云端有，云端记录保留着——将来 Phase 6 做完整消息同步时激活。
 *
 * 首次登录的 backfill：
 *   遍历本地所有 session id，逐个 markDirty，让它们被 push 上去建档。
 *   保证用户老数据也能同步到云端。
 */

import {
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from '@/shared/providers/auth-provider';
import {
  buildCloudPayload,
  deleteCloudSession,
  fetchCloudSessions,
  getAllLocalSessionIds,
  upsertCloudSession,
} from './session-sync';
import {
  markSessionDirty,
  subscribeSessionDirty,
} from './session-dirty-queue';
import { markFailed, markOk, markSyncing } from './sync-status';

export function SessionSyncProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const userIdRef = useRef<string | null>(null);

  // 保持 userId 最新，订阅回调里用 ref 读（避免频繁 re-subscribe）
  useEffect(() => {
    userIdRef.current =
      status === 'authenticated' && user ? user.id : null;
  }, [status, user]);

  // ── 登录后：fetch + backfill ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (status !== 'authenticated' || !user) return;

      try {
        // 1) 先 fetch 云端（当前只打印）
        const cloud = await fetchCloudSessions();
        if (cancelled) return;
        console.log(
          `[session-sync] Fetched ${cloud.length} cloud sessions`
        );

        // 2) Backfill：本地所有 session 都 markDirty 一次，触发首次上云
        //    已存在的云端记录会被 upsert 覆盖，幂等安全
        const localIds = await getAllLocalSessionIds();
        if (cancelled) return;
        if (localIds.length > 0) {
          console.log(
            `[session-sync] Backfilling ${localIds.length} local sessions`
          );
          for (const id of localIds) {
            markSessionDirty(id);
          }
        }
      } catch (err) {
        console.error('[session-sync] bootstrap failed:', err);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [status, user]);

  // ── 订阅 dirty queue，执行实际的云端 upsert / delete ──────────────────────
  useEffect(() => {
    const unsubscribe = subscribeSessionDirty(async (entries) => {
      const userId = userIdRef.current;
      if (!userId) {
        // 未登录态下不 flush，让这些变更等到下次登录时由 backfill 重新拉起
        return;
      }

      markSyncing('sessions');
      let anyFailed = false;
      for (const [sessionId, kind] of entries) {
        try {
          if (kind === 'delete') {
            await deleteCloudSession(sessionId);
          } else {
            const payload = await buildCloudPayload(sessionId);
            if (!payload) {
              // 本地 session 已不存在（可能是 deleteTask 清空后刚好 markDirty）→ 转 delete
              await deleteCloudSession(sessionId);
              continue;
            }
            await upsertCloudSession(userId, payload);
          }
        } catch (err) {
          anyFailed = true;
          console.error(
            `[session-sync] flush failed for ${sessionId} (${kind}):`,
            err
          );
        }
      }
      if (anyFailed) {
        markFailed('sessions', 'some sessions failed to sync');
      } else {
        markOk('sessions');
      }
    });

    return unsubscribe;
  }, []);

  return <>{children}</>;
}