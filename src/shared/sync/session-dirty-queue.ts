/**
 * Session dirty queue — minimal kernel.
 *
 * 独立文件，不 import db / supabase。
 * 存在目的：database.ts 写入后可通知"有脏"，但不形成循环依赖。
 * session-sync.ts（读 db + 访问 supabase）订阅此队列实际执行 flush。
 */

type DirtyKind = 'upsert' | 'delete';
type DirtyListener = (entries: Map<string, DirtyKind>) => void;

const dirtyQueue = new Map<string, DirtyKind>();
const dirtyListeners = new Set<DirtyListener>();
let dirtyFlushTimer: ReturnType<typeof setTimeout> | null = null;
const DIRTY_DEBOUNCE_MS = 500;

function notifyDirty() {
  if (dirtyFlushTimer) clearTimeout(dirtyFlushTimer);
  dirtyFlushTimer = setTimeout(() => {
    dirtyFlushTimer = null;
    if (dirtyQueue.size === 0) return;
    const snapshot = new Map(dirtyQueue);
    dirtyQueue.clear();
    for (const listener of dirtyListeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[session-dirty-queue] listener error:', err);
      }
    }
  }, DIRTY_DEBOUNCE_MS);
}

/** 标记一个 session 需要 upsert 到云端（合并同一 tick 多次标记） */
export function markSessionDirty(sessionId: string): void {
  // 如果已经是 delete 待办，则 upsert 不能覆盖 delete
  const existing = dirtyQueue.get(sessionId);
  if (existing === 'delete') return;
  dirtyQueue.set(sessionId, 'upsert');
  notifyDirty();
}

/** 标记一个 session 需要从云端删除。覆盖之前的 upsert 标记。 */
export function markSessionDeleted(sessionId: string): void {
  dirtyQueue.set(sessionId, 'delete');
  notifyDirty();
}

/**
 * 订阅 dirty 刷写事件。返回解绑函数。
 */
export function subscribeSessionDirty(
  listener: DirtyListener
): () => void {
  dirtyListeners.add(listener);
  return () => {
    dirtyListeners.delete(listener);
  };
}

/**
 * 立刻 flush 等待中的 dirty（清 timer 并同步通知）。
 * 预留给"即将退出"之类的场景。
 */
export function flushSessionDirtyNow(): void {
  if (dirtyFlushTimer) {
    clearTimeout(dirtyFlushTimer);
    dirtyFlushTimer = null;
  }
  if (dirtyQueue.size === 0) return;
  const snapshot = new Map(dirtyQueue);
  dirtyQueue.clear();
  for (const listener of dirtyListeners) {
    try {
      listener(snapshot);
    } catch {
      /* ignore */
    }
  }
}

export type { DirtyKind, DirtyListener };
