/**
 * Cloud Cleanup — 清除当前用户在云端 Supabase 的会话历史（messages + tasks）。
 *
 * 设计意图：
 *   "会话历史"是隐私敏感度最高的一类数据（含具体投资讨论、金额、判断逻辑）；
 *   "用户偏好 / 分身画像 / 登录态"敏感度较低，不属于这次清除范围。
 *   因此本 helper 严格只动两张表：messages、tasks。
 *
 *   不动：
 *     - persona_memory（蒸馏画像，清掉 = 用户得重新训练分身）
 *     - user_notes（用户主动写的笔记）
 *     - profiles（用户基础资料）
 *     - auth session（清掉 = 用户得重登）
 *     - settings（本地偏好 / 主题 / 语言）
 *
 * 安全模型：
 *   - RLS policy "Users can delete their own messages/tasks" 已保证用户只能
 *     删自己的数据，物理上不可能误删别人的。
 *   - 应用层再加一道 .eq('user_id', uid) 显式过滤作为 defense-in-depth；
 *     即使 RLS 未来失效，应用层仍按 uid 隔离。
 *
 * 同步顺序（重要）：
 *   1. 停 message sync worker（防止删完云端后 worker 又把本地积压 push 上去）
 *   2. 清当前用户的 sync_queue（删本地未发送的 message insert，否则它们会重发）
 *   3. 删云端 messages + tasks（RLS 自动按 auth.uid() 过滤）
 *   4. 重启 sync worker
 *
 * 本地清理：调用方在调本函数前/后自行清本地 SQLite/IndexedDB；
 *   本函数只负责"上云的部分"，避免职责越界。
 */

import { getCurrentBoundUid } from '@/shared/db/database';
import { supabase } from '@/shared/lib/supabase';

import {
  startMessageSyncWorker,
  stopMessageSyncWorker,
} from './messages-sync';
import { clearQueueForUser } from './sync-queue';

export async function clearCloudConversations(): Promise<void> {
  const uid = getCurrentBoundUid();
  if (!uid) {
    throw new Error('无法清除云端会话：用户未登录');
  }

  // 1. 停 worker（避免删完后 worker 把本地积压再次推上云）
  stopMessageSyncWorker();

  try {
    // 2. 清本地 sync_queue（防 messages insert 被重发）
    await clearQueueForUser(uid);

    // 3. 删云端 messages（RLS + 显式 user_id 双重过滤）
    const { error: msgErr } = await supabase
      .from('messages')
      .delete()
      .eq('user_id', uid);
    if (msgErr) {
      throw new Error(`删除云端 messages 失败：${msgErr.message}`);
    }

    // 4. 删云端 tasks
    const { error: taskErr } = await supabase
      .from('tasks')
      .delete()
      .eq('user_id', uid);
    if (taskErr) {
      throw new Error(`删除云端 tasks 失败：${taskErr.message}`);
    }
  } finally {
    // 5. 重启 worker（即使中途失败也要恢复，否则后续新对话同步会停摆）
    startMessageSyncWorker();
  }
}
