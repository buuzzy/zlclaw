/**
 * Compaction Store — per-task compaction summaries.
 *
 * Stores compaction results separately from conversation messages.
 * Original messages are NEVER deleted — compaction only affects what
 * the model sees in the context window.
 *
 * Storage: ~/.htclaw/compaction/{sanitized-taskId}.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface StoredCompaction {
  /** The compaction summary text */
  summary: string;
  /** Number of messages covered by this summary (from index 0) */
  compactedUpTo: number;
  /** Estimated tokens in the summary */
  tokenEstimate: number;
  /** When this compaction was created */
  createdAt: string;
  /** Preserved identifiers */
  identifiers: string[];
}

function compactionDir(): string {
  return join(homedir(), '.htclaw', 'compaction');
}

function compactionPath(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(compactionDir(), `${safe}.json`);
}

export function loadCompaction(taskId: string): StoredCompaction | null {
  const p = compactionPath(taskId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as StoredCompaction;
  } catch {
    return null;
  }
}

export function saveCompaction(taskId: string, data: StoredCompaction): void {
  const dir = compactionDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(compactionPath(taskId), JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[CompactionStore] Saved compaction for ${taskId}: ${data.tokenEstimate} tokens, covers ${data.compactedUpTo} messages`);
}

export function deleteCompaction(taskId: string): boolean {
  const p = compactionPath(taskId);
  if (!existsSync(p)) return false;
  try {
    require('fs').unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
