/**
 * Error Sync — Phase 4 of cloud sync
 *
 * 数据源：public.error_logs（Supabase）
 *
 * 职责：
 *   • reportError() 把错误/反馈事件 insert 到云端
 *   • 失败时落盘到 ~/.sage/error-queue.jsonl 作为离线队列
 *   • 启动时 flushQueue() 重放历史队列
 *
 * 设计原则：
 *   • 永不 throw：错误上报本身不能成为新的错误源
 *   • 允许匿名：user_id = null 也能 insert（RLS 政策允许）
 *   • 敏感字段保护：context 走白名单，stack_trace 不做截断（方便排查）
 *
 * 非职责：
 *   • 采样（本期 100% 上报）
 *   • 用户可见的错误历史 UI
 *   • 聚合 / 告警
 */

import { supabase } from '@/shared/lib/supabase';
import { markFailed, markOk, markSyncing } from './sync-status';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ErrorType =
  | 'api_error'
  | 'skill_error'
  | 'crash' // React Error Boundary
  | 'network_error'
  | 'unhandled_rejection'
  | 'window_error'
  | 'feedback';

export interface ErrorEvent {
  error_type: ErrorType;
  message: string;
  /** 可选错误码（HTTP status、skill name、feedback category 等） */
  error_code?: string;
  stack_trace?: string;
  /** 任意上下文，调用方自行填充，不会再做过滤（请自律） */
  context?: Record<string, unknown>;
}

interface ErrorRow {
  user_id: string | null;
  error_type: ErrorType;
  error_code: string | null;
  message: string;
  stack_trace: string | null;
  context: Record<string, unknown> | null;
  app_version: string | null;
  platform: string | null;
  os_version: string | null;
}

// ─── Env helpers ─────────────────────────────────────────────────────────────

const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function detectOsVersion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  // macOS: "Mac OS X 10_15_7" / "Mac OS X 14_0"
  const macMatch = ua.match(/Mac OS X ([\d_]+)/);
  if (macMatch) return macMatch[1].replace(/_/g, '.');
  // Windows
  const winMatch = ua.match(/Windows NT ([\d.]+)/);
  if (winMatch) return winMatch[1];
  return null;
}

// ─── Current user id accessor ────────────────────────────────────────────────
//
// 避免 import AuthProvider（顶层 context 循环风险）。
// 直接问 supabase.auth。getSession() 是异步但本地 cache hit 通常很快。

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Core ────────────────────────────────────────────────────────────────────

async function buildRow(event: ErrorEvent): Promise<ErrorRow> {
  const userId = await getCurrentUserId();
  return {
    user_id: userId,
    error_type: event.error_type,
    error_code: event.error_code ?? null,
    message: event.message,
    stack_trace: event.stack_trace ?? null,
    context: event.context ?? null,
    app_version: APP_VERSION,
    platform: detectPlatform(),
    os_version: detectOsVersion(),
  };
}

async function insertToSupabase(row: ErrorRow): Promise<boolean> {
  try {
    const { error } = await supabase.from('error_logs').insert(row);
    if (error) {
      console.warn('[error-sync] insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[error-sync] insert threw:', err);
    return false;
  }
}

// ─── Offline queue（~/.sage/error-queue.jsonl） ───────────────────────────────
//
// 上云失败时把 row 追加到 jsonl 文件。App 启动时 flushQueue 读出逐条重放。

const QUEUE_FILE_NAME = 'error-queue.jsonl';

async function getQueueFilePath(): Promise<string | null> {
  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const dir = await appDataDir();
    return `${dir}/${QUEUE_FILE_NAME}`;
  } catch {
    return null;
  }
}

async function appendToQueue(row: ErrorRow): Promise<void> {
  const path = await getQueueFilePath();
  if (!path) return;
  try {
    const { writeTextFile, readTextFile } = await import(
      '@tauri-apps/plugin-fs'
    );
    const line = JSON.stringify(row) + '\n';
    let existing = '';
    try {
      existing = await readTextFile(path);
    } catch {
      /* file doesn't exist */
    }
    await writeTextFile(path, existing + line);
  } catch (err) {
    // 最后一道防线：连本地文件都写不了，只 console
    console.warn('[error-sync] failed to append to queue:', err);
  }
}

/**
 * 尝试重放离线队列。成功则清空文件。
 * 启动时调用一次即可（main.tsx bootstrap）。
 * 失败的行会写回文件，下次再试。
 */
export async function flushErrorQueue(): Promise<void> {
  const path = await getQueueFilePath();
  if (!path) return;

  let raw = '';
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    raw = await readTextFile(path);
  } catch {
    return; // 文件不存在 = 没有积压
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;

  console.log(`[error-sync] flushing ${lines.length} queued errors`);

  const leftover: string[] = [];
  for (const line of lines) {
    let row: ErrorRow;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // 坏行丢掉
    }
    const ok = await insertToSupabase(row);
    if (!ok) leftover.push(line);
  }

  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(
      path,
      leftover.length > 0 ? leftover.join('\n') + '\n' : ''
    );
  } catch (err) {
    console.warn('[error-sync] failed to rewrite queue:', err);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 上报一个错误/反馈事件到云端。
 *
 * 永不抛出：
 *   • 构造 row 失败 → 静默丢弃
 *   • supabase insert 失败 → 落本地 jsonl 队列
 *   • 队列文件写失败 → console.warn 后丢弃
 *
 * 调用方不需要 try/catch 包装。
 */
export async function reportError(event: ErrorEvent): Promise<void> {
  let row: ErrorRow;
  try {
    row = await buildRow(event);
  } catch (err) {
    console.warn('[error-sync] buildRow failed:', err);
    return;
  }

  markSyncing('error');
  const ok = await insertToSupabase(row);
  if (ok) {
    markOk('error');
  } else {
    await appendToQueue(row);
    markFailed('error', 'insert failed, queued locally');
  }
}
