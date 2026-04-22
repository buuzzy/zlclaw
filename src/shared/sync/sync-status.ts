/**
 * Sync Status — Phase 5 of cloud sync
 *
 * 汇总四条同步链路的状态（profile / settings / sessions / error）给 UI 展示。
 *
 * 设计：
 *   • 每条链路调 markSyncing(channel) / markOk(channel) / markFailed(channel)
 *   • 全局聚合：
 *       - 只要有 channel 在 syncing → 整体 syncing
 *       - 否则只要有 channel failed → 整体 failed
 *       - 全部 ok → 整体 ok
 *   • 提供 React hook useSyncStatus() 让 UI 订阅
 *
 * 零依赖：不 import supabase / React / providers，方便在任何地方调用。
 */

import { useSyncExternalStore } from 'react';

export type SyncChannel = 'profile' | 'settings' | 'sessions' | 'error';
export type ChannelState = 'idle' | 'syncing' | 'ok' | 'failed';

interface ChannelSnapshot {
  state: ChannelState;
  /** 最近一次成功或失败的时间戳 (ms) */
  lastChangedAt: number;
  /** 最近一次错误消息（若有） */
  lastError?: string;
  /** 连续失败次数（成功后清零），用于指数退避 */
  failCount: number;
}

export type OverallStatus = 'idle' | 'syncing' | 'ok' | 'failed';

export interface SyncStatusSnapshot {
  overall: OverallStatus;
  channels: Record<SyncChannel, ChannelSnapshot>;
  lastSyncedAt: number | null;
}

// ─── Internal state ──────────────────────────────────────────────────────────

const initialChannel = (): ChannelSnapshot => ({
  state: 'idle',
  lastChangedAt: 0,
  failCount: 0,
});

let snapshot: SyncStatusSnapshot = {
  overall: 'idle',
  channels: {
    profile: initialChannel(),
    settings: initialChannel(),
    sessions: initialChannel(),
    error: initialChannel(),
  },
  lastSyncedAt: null,
};

const listeners = new Set<() => void>();

function recompute(): void {
  const chs = snapshot.channels;
  const allStates: ChannelState[] = Object.values(chs).map((c) => c.state);

  let overall: OverallStatus;
  if (allStates.some((s) => s === 'syncing')) {
    overall = 'syncing';
  } else if (allStates.some((s) => s === 'failed')) {
    overall = 'failed';
  } else if (allStates.some((s) => s === 'ok')) {
    overall = 'ok';
  } else {
    overall = 'idle';
  }

  const okTimestamps = Object.values(chs)
    .filter((c) => c.state === 'ok')
    .map((c) => c.lastChangedAt);
  const lastSyncedAt =
    okTimestamps.length > 0 ? Math.max(...okTimestamps) : snapshot.lastSyncedAt;

  // 重建 snapshot 引用，让 useSyncExternalStore 感知到变化
  snapshot = { overall, channels: { ...chs }, lastSyncedAt };

  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function updateChannel(
  channel: SyncChannel,
  patch: Partial<ChannelSnapshot>
): void {
  snapshot.channels[channel] = {
    ...snapshot.channels[channel],
    ...patch,
    lastChangedAt: Date.now(),
  };
  recompute();
}

// ─── Public API：上报状态 ────────────────────────────────────────────────────

export function markSyncing(channel: SyncChannel): void {
  // 不动 failCount（等 success/fail 最终态时再决定）
  updateChannel(channel, { state: 'syncing', lastError: undefined });
}

export function markOk(channel: SyncChannel): void {
  updateChannel(channel, { state: 'ok', lastError: undefined, failCount: 0 });
}

export function markFailed(channel: SyncChannel, error?: unknown): void {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined;
  const prev = snapshot.channels[channel];
  updateChannel(channel, {
    state: 'failed',
    lastError: msg,
    failCount: prev.failCount + 1,
  });
}

// ─── Retry 机制 ──────────────────────────────────────────────────────────────
//
// 各 channel 在 mount 时注册自己的"重试入口"。当网络恢复或用户手动重试时，
// 调 retryFailedChannels() 会遍历所有 failed 的 channel 触发其 retry。
// 这样能避免上次失败的陈旧 failed 标记压盖新一轮成功的 ok 状态。

type RetryHandler = () => Promise<void> | void;
const retryHandlers = new Map<SyncChannel, RetryHandler>();

export function registerRetryHandler(
  channel: SyncChannel,
  handler: RetryHandler
): () => void {
  retryHandlers.set(channel, handler);
  return () => {
    if (retryHandlers.get(channel) === handler) {
      retryHandlers.delete(channel);
    }
  };
}

/**
 * 触发所有当前处于 failed 状态的 channel 重试。
 *
 * 退避策略（避免频繁闪烁）：
 *   failCount=1 → 等 15s
 *   failCount=2 → 等 30s
 *   failCount=3 → 等 60s
 *   failCount=4+→ 等 120s（封顶）
 *
 * - `force=true` 跳过退避（用户手动点"立即重试"、window.online 事件）。
 * - 定时轮询调用时用默认 `force=false`，失败次数多时会安静等待。
 *
 * 同一时刻只允许一次并发 retry。
 */
let retryInFlight = false;

const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];

function backoffFor(failCount: number): number {
  if (failCount <= 0) return 0;
  return BACKOFF_MS[Math.min(failCount - 1, BACKOFF_MS.length - 1)];
}

export async function retryFailedChannels(
  options: { force?: boolean } = {}
): Promise<void> {
  if (retryInFlight) return;

  const now = Date.now();
  const failed = (Object.entries(snapshot.channels) as [SyncChannel, ChannelSnapshot][])
    .filter(([, c]) => c.state === 'failed')
    .filter(([, c]) => {
      if (options.force) return true;
      const waitMs = backoffFor(c.failCount);
      const elapsed = now - c.lastChangedAt;
      return elapsed >= waitMs;
    })
    .map(([name]) => name);

  if (failed.length === 0) return;

  retryInFlight = true;
  console.log(
    `[sync-status] retrying failed channels:`,
    failed,
    options.force ? '(forced)' : ''
  );
  try {
    for (const channel of failed) {
      const handler = retryHandlers.get(channel);
      if (handler) {
        try {
          await handler();
        } catch (err) {
          console.warn(`[sync-status] retry handler for ${channel} threw:`, err);
        }
      }
    }
  } finally {
    retryInFlight = false;
  }
}

// ─── React hook ──────────────────────────────────────────────────────────────

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SyncStatusSnapshot {
  return snapshot;
}

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
