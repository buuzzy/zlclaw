/**
 * Session Sync — Phase 3 of cloud sync (最小闭环版)
 *
 * 数据源：public.sessions（Supabase，元数据 only）
 *
 * 职责：
 *   • 聚合本地 session + 所有 tasks + messages + files，构造云端 payload
 *   • 把本地 session 元数据 upsert 到云端
 *   • 删除本地 session 时同步 delete 云端
 *   • fetch 云端 session 列表（本版仅内存持有，供将来 UI 使用）
 *
 * 非职责（本版不做）：
 *   • 把云端独有 session merge 到本地 SQLite
 *   • UI 上显示云端独有 session
 *   • 消息体跨设备同步
 *   • Realtime 订阅
 *
 * 云端字段映射：
 *   id            ← 本地 sessions.id
 *   user_id       ← 当前 user.id
 *   title         ← sessions.prompt 截 80 字
 *   preview       ← 最后一条 message.content 截 120 字
 *   message_count ← 聚合该 session 下所有 tasks 的 messages 条数
 *   has_artifacts ← 该 session 下是否有 files 记录
 *   updated_at    ← 本地 sessions.updated_at
 */

import { supabase } from '@/shared/lib/supabase';
import {
  getAllTasks,
  getFilesByTaskId,
  getMessagesByTaskId,
  getSession,
  getTasksBySessionId,
} from '@/shared/db/database';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloudSession {
  id: string;
  user_id: string;
  title: string | null;
  preview: string | null;
  message_count: number;
  has_artifacts: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionPayload {
  id: string;
  title: string | null;
  preview: string | null;
  message_count: number;
  has_artifacts: boolean;
  updated_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TITLE_MAX = 80;
const PREVIEW_MAX = 120;

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

/**
 * 根据本地数据构造云端 payload。
 * 会读本地 SQLite（sessions/tasks/messages/files）聚合出所需字段。
 * 若本地 session 不存在（已删除），返回 null。
 *
 * 字段语义：
 *   • `title`      — 会话最初启动的 prompt（永不变）
 *   • `preview`    — 用户最近一次提问（只看 user 类型），更像会话目录
 *   • `message_count` — 对话气泡消息总数（user + text）
 *     ⚠️ 已知问题：Agent 流式输出会在本地写多条 text（中间态 + 终态），
 *        导致数字比实际轮次大。待 useAgent.ts 重构后统一修复。
 *   • `has_artifacts` — 是否有附带产物（文件）
 */

// 参与 message_count 的对话气泡 type
const CONVERSATION_TYPES = new Set(['text', 'user']);

export async function buildCloudPayload(
  sessionId: string
): Promise<SessionPayload | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const tasks = await getTasksBySessionId(sessionId);

  // 聚合 messages：
  //   • message_count 统计 user + text（所有对话气泡）
  //   • preview 只从 user 类型里取时间最新的一条，更贴近"会话目录"语义
  let messageCount = 0;
  let lastUserContent: string | null = null;
  let lastUserTime = 0;

  for (const task of tasks) {
    const messages = await getMessagesByTaskId(task.id);
    for (const msg of messages) {
      if (!CONVERSATION_TYPES.has(msg.type)) continue;
      if (!msg.content) continue;
      messageCount += 1;
      if (msg.type === 'user') {
        const t = new Date(msg.created_at).getTime();
        if (t > lastUserTime) {
          lastUserTime = t;
          lastUserContent = msg.content;
        }
      }
    }
  }

  // 若该 session 连一条 user 消息都没有（极端：刚建会话还没开口），
  // 回退到 session.prompt（等同 title），总比空强
  const previewSource = lastUserContent ?? session.prompt;

  // 检查 artifacts：只要有一个 task 有 file，就 true
  let hasArtifacts = false;
  for (const task of tasks) {
    const files = await getFilesByTaskId(task.id);
    if (files.length > 0) {
      hasArtifacts = true;
      break;
    }
  }

  return {
    id: session.id,
    title: truncate(session.prompt, TITLE_MAX),
    preview: truncate(previewSource, PREVIEW_MAX),
    message_count: messageCount,
    has_artifacts: hasArtifacts,
    updated_at: session.updated_at,
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * 拉取当前用户的所有云端 session（按 updated_at 降序）。
 * 失败抛出。
 */
export async function fetchCloudSessions(): Promise<CloudSession[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`[session-sync] fetchCloudSessions: ${error.message}`);
  }
  return (data ?? []) as CloudSession[];
}

/**
 * UPSERT 单个 session 到云端。
 * user_id 由 RLS 自动保证（INSERT with user_id 必须等于 auth.uid()），
 * 这里主动传入让 upsert 能走到。
 *
 * 失败抛出。
 */
export async function upsertCloudSession(
  userId: string,
  payload: SessionPayload
): Promise<void> {
  const { error } = await supabase.from('sessions').upsert(
    {
      id: payload.id,
      user_id: userId,
      title: payload.title,
      preview: payload.preview,
      message_count: payload.message_count,
      has_artifacts: payload.has_artifacts,
      updated_at: payload.updated_at,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(`[session-sync] upsertCloudSession: ${error.message}`);
  }
}

/**
 * 从云端删除 session（及其级联 message_count 等）。
 * 失败抛出。
 */
export async function deleteCloudSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    throw new Error(`[session-sync] deleteCloudSession: ${error.message}`);
  }
}

// ─── Dirty queue (re-export) ──────────────────────────────────────────────────
// 队列逻辑拆在 session-dirty-queue.ts，避免和 database.ts 循环依赖。
// 这里 re-export 方便 consumer 从 @/shared/sync 一个入口拿到所有 API。

export {
  markSessionDirty,
  markSessionDeleted,
  subscribeSessionDirty,
  flushSessionDirtyNow,
  type DirtyKind,
  type DirtyListener,
} from './session-dirty-queue';

// ─── Utility: 扫描所有本地 session（首次登录时 backfill） ───────────────────

/**
 * 返回本地所有 session id（不含详情）。
 * 用于首次登录 or 大规模重同步时。
 */
export async function getAllLocalSessionIds(): Promise<string[]> {
  const tasks = await getAllTasks();
  const ids = new Set<string>();
  for (const t of tasks) {
    if (t.session_id) ids.add(t.session_id);
  }
  return Array.from(ids);
}
