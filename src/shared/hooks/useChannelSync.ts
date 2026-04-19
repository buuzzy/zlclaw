/**
 * Channel Conversation Sync Hook
 *
 * Idempotent sync: polls ALL channel conversations from the backend,
 * checks the local DB for each, and creates tasks/messages only if missing.
 * Does NOT depend on the backend's `synced` flag — safe against race conditions.
 */

import { useCallback, useEffect, useRef } from 'react';
import { API_BASE_URL } from '@/config';
import {
  createMessage,
  createSession,
  createTask,
  getMessagesByTaskId,
  getTask,
} from '@/shared/db';

interface ChannelMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChannelConversation {
  id: string;
  channel: string;
  prompt: string;
  messages: ChannelMessage[];
  status: 'completed' | 'error';
  createdAt: number;
  updatedAt: number;
  version: number;
}

const CHANNEL_LABELS: Record<string, string> = {
  wechat: '微信',
  feishu: '飞书',
};

const POLL_INTERVAL = 3000;

/**
 * Track deleted channel task IDs so sync doesn't recreate them.
 * Persisted in localStorage to survive app restarts.
 * This ensures deleted tasks stay deleted even if the app is restarted before sync completes.
 */
const DELETED_KEY = 'channelSync:deletedIds';

function getDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addDeletedId(id: string): void {
  const ids = getDeletedIds();
  ids.add(id);
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** Call this when a channel-originated task is deleted by the user */
export function markChannelTaskDeleted(taskId: string): void {
  addDeletedId(taskId);
}

export function useChannelSync(onNewTask?: () => void) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false);

  const syncOnce = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      const res = await fetch(`${API_BASE_URL}/channels/conversations/all`);
      if (!res.ok) {
        console.warn('[ChannelSync] Poll failed:', res.status);
        return;
      }

      const data = (await res.json()) as {
        total: number;
        conversations: ChannelConversation[];
      };

      if (!data.conversations?.length) return;

      const deletedIds = getDeletedIds();
      let changed = false;

      // Clean up deletedIds: if a conversation no longer exists on the backend,
      // it's safe to remove from the blocked list (it won't be recreated).
      if (deletedIds.size > 0) {
        const backendIds = new Set(data.conversations.map((c) => c.id));
        const toRemove = [...deletedIds].filter((id) => !backendIds.has(id));
        if (toRemove.length > 0) {
          const updated = getDeletedIds();
          toRemove.forEach((id) => updated.delete(id));
          try {
            if (updated.size === 0) {
              localStorage.removeItem(DELETED_KEY);
            } else {
              localStorage.setItem(DELETED_KEY, JSON.stringify([...updated]));
            }
          } catch {
            /* ignore */
          }
        }
      }

      for (const conv of data.conversations) {
        try {
          const taskId = conv.id;
          // Skip tasks the user has explicitly deleted
          if (deletedIds.has(taskId)) continue;

          const existing = await getTask(taskId);

          if (!existing) {
            const channelLabel = CHANNEL_LABELS[conv.channel] ?? conv.channel;
            const sessionId = `ch_${conv.createdAt}`;

            try {
              await createSession({
                id: sessionId,
                prompt: `[${channelLabel}] ${conv.prompt}`,
              });
            } catch {
              // session may already exist
            }

            await createTask({
              id: taskId,
              session_id: sessionId,
              task_index: 1,
              prompt: `[${channelLabel}] ${conv.prompt}`,
            });

            for (const msg of conv.messages) {
              await createMessage({
                task_id: taskId,
                type: msg.role === 'user' ? 'user' : 'text',
                content: msg.content,
              });
            }

            console.log('[ChannelSync] Created task:', taskId);
            changed = true;
          } else {
            // ── Incremental sync: use content fingerprint instead of length offset ──
            // The old approach `conv.messages.slice(existingMsgs.length)` assumed
            // messages are strictly append-only and never duplicated. If the backend
            // restarts (in-memory store reset) or messages arrive out of order,
            // the length offset becomes permanently wrong and silently drops messages.
            //
            // New approach: build a Set of fingerprints (role + first 120 chars of content)
            // from existing local messages, then only insert messages whose fingerprint
            // is not yet present. This is idempotent and order-independent.
            const existingMsgs = await getMessagesByTaskId(taskId);
            const existingFingerprints = new Set(
              existingMsgs.map(
                (m) => `${m.type}:${(m.content ?? '').slice(0, 120)}`
              )
            );

            const newMessages = conv.messages.filter((msg) => {
              const type = msg.role === 'user' ? 'user' : 'text';
              const fp = `${type}:${(msg.content ?? '').slice(0, 120)}`;
              return !existingFingerprints.has(fp);
            });

            for (const msg of newMessages) {
              await createMessage({
                task_id: taskId,
                type: msg.role === 'user' ? 'user' : 'text',
                content: msg.content,
              });
            }

            if (newMessages.length > 0) {
              console.log(
                '[ChannelSync] Appended',
                newMessages.length,
                'msgs to',
                taskId
              );
              changed = true;
            }
          }
        } catch (err) {
          console.error('[ChannelSync] Failed to sync', conv.id, err);
        }
      }

      if (changed) {
        onNewTask?.();
      }
    } catch (err) {
      console.warn('[ChannelSync] Poll error:', err);
    } finally {
      syncingRef.current = false;
    }
  }, [onNewTask]);

  useEffect(() => {
    syncOnce();
    timerRef.current = setInterval(syncOnce, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [syncOnce]);

  return { syncNow: syncOnce };
}
