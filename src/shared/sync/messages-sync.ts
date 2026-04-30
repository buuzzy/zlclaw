/**
 * Messages Sync — 本地 messages → 云端 public.messages 的火忘式双写
 *
 * 数据流：
 *   createMessage() 本地写成功
 *     ↓ (火忘)
 *   enqueueMessageInsert(msg)  ← 入 sync_queue
 *     ↓
 *   后台 worker loop
 *     ↓
 *   supabase.from('messages').insert(transformed)
 *     ↓
 *   markDone() 删队列项
 *
 * 失败：
 *   markFailed() 增 retry_count + 指数退避
 *
 * 设计原则：
 *   • 本地永远写成功，云端写靠队列保证最终一致
 *   • 用户对云端写延迟零感知
 *   • Worker 单实例（防并发抢同一行造成重复 insert）
 *   • 用户切换 / 登出 时 stop worker
 */

import type { Message } from '@/shared/db/types';
import { supabase } from '@/shared/lib/supabase';

import {
  drainBatch,
  enqueueSync,
  markDone,
  markFailed,
  type SyncQueueRow,
} from './sync-queue';

// ─── Transform: 本地 Message → 云端 messages 行 ────────────────────────────

/**
 * 本地 Message 直接映射云端字段（schema 已对齐）。
 * id / user_id / created_at / updated_at 都是客户端生成的 UUID/ISO，
 * 云端不会用 default 覆盖（INSERT 显式带值）。
 */
function transformMessageForCloud(msg: Message): Record<string, unknown> {
  return {
    id: msg.id,
    user_id: msg.user_id,
    task_id: msg.task_id,
    type: msg.type,
    content: msg.content,
    tool_name: msg.tool_name,
    tool_input: msg.tool_input,
    tool_output: msg.tool_output,
    tool_use_id: msg.tool_use_id,
    tool_metadata: msg.tool_metadata,
    subtype: msg.subtype,
    error_message: msg.error_message,
    attachments: msg.attachments,
    created_at: msg.created_at,
    updated_at: msg.updated_at,
  };
}

// ─── Public API: enqueue ─────────────────────────────────────────────────────

/**
 * 把一条本地写好的 message 入云端同步队列。
 * 调用方在本地 INSERT 成功后调（不 await，火忘）。
 */
export function enqueueMessageInsert(msg: Message): void {
  void enqueueSync('messages', 'insert', transformMessageForCloud(msg)).catch(
    (err) => {
      console.error('[messages-sync] enqueue failed:', err);
    }
  );
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;

let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerRunning = false;
let workerInFlight = false;

/**
 * 处理单个队列项：根据 table_name × operation 调对应 supabase API。
 * 现在只支持 messages × insert，未来扩展按 table_name 分发。
 */
async function processQueueRow(row: SyncQueueRow): Promise<void> {
  const payload = JSON.parse(row.payload);

  if (row.table_name === 'messages' && row.operation === 'insert') {
    const { error } = await supabase.from('messages').upsert(payload, {
      onConflict: 'id',
    });
    if (error) throw error;
    return;
  }

  // 未知组合 → 标记为已完成（避免无限重试），但 log warn
  console.warn(
    `[messages-sync] unknown queue item: ${row.table_name}/${row.operation}, marking done`
  );
}

async function tick(): Promise<void> {
  if (workerInFlight) return;
  workerInFlight = true;
  try {
    const batch = await drainBatch(BATCH_SIZE);
    if (batch.length === 0) return;

    for (const row of batch) {
      try {
        await processQueueRow(row);
        await markDone(row.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[messages-sync] sync failed for ${row.table_name}/${row.id} (retry=${row.retry_count}):`,
          msg
        );
        await markFailed(row.id, msg);
      }
    }
  } catch (err) {
    console.error('[messages-sync] worker tick error:', err);
  } finally {
    workerInFlight = false;
  }
}

function scheduleNext(): void {
  if (!workerRunning) return;
  workerTimer = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, TICK_INTERVAL_MS);
}

/**
 * 启动后台 sync worker（幂等）。
 * 调用时机：AuthProvider 在 bindUserId 完成后。
 */
export function startMessageSyncWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  console.log('[messages-sync] worker started');
  void tick().then(scheduleNext);
}

/**
 * 停止 worker（幂等）。
 * 调用时机：AuthProvider 在 unbindUser 时。
 */
export function stopMessageSyncWorker(): void {
  workerRunning = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  console.log('[messages-sync] worker stopped');
}

/**
 * 手动触发一次同步（用于 UI "立即同步"按钮、或 smoke test）。
 */
export async function syncNow(): Promise<void> {
  await tick();
}
