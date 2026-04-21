/**
 * Daily Memory Writer
 *
 * Appends a single user↔assistant exchange to today's daily memory file
 * (~/.sage/memory/YYYY-MM-DD.md) and triggers an incremental vector
 * re-index of that file.
 *
 * Rules:
 *  - Trivial turns are skipped (user message < 5 chars, or pure greetings).
 *  - User message is truncated to 200 chars; assistant reply to 300 chars.
 *  - Disk write is synchronous (cheap); vector indexing is fire-and-forget.
 *  - All errors are non-fatal — logged as warnings only.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { getAppDir } from '@/config/constants';
import { indexSource } from './indexer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_MAX_LEN = 200;
const ASSISTANT_MAX_LEN = 300;

/** Minimum user message length to bother recording (avoids "hi", "ok", etc.) */
const MIN_USER_LEN = 5;

/** Simple heuristic: skip pure greeting/acknowledgement turns */
const TRIVIAL_PATTERN = /^(hi|hello|hey|ok|okay|thanks|thank you|谢谢|你好|再见|bye|嗯|好的|好|是的?|是|不|没有?|对|对的?)\s*[.!。！~～]*$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isTrivial(userMsg: string): boolean {
  const trimmed = userMsg.trim();
  if (trimmed.length < MIN_USER_LEN) return true;
  if (TRIVIAL_PATTERN.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append one exchange to today's daily memory file.
 *
 * @param userMsg     - The user's raw message text.
 * @param assistantMsg - The assistant's final reply text (concatenated content).
 */
export function appendDailyMemory(userMsg: string, assistantMsg: string): void {
  try {
    const trimmedUser = userMsg.trim();
    const trimmedAssistant = assistantMsg.trim();

    // Skip empty or trivial turns
    if (!trimmedUser || !trimmedAssistant) return;
    if (isTrivial(trimmedUser)) return;

    const memDir = join(getAppDir(), 'memory');
    if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });

    const dateStr = todayDateStr();
    const filePath = join(memDir, `${dateStr}.md`);
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const entry =
      `\n### ${time}\n` +
      `- **用户**: ${trimmedUser.slice(0, USER_MAX_LEN)}\n` +
      `- **助手**: ${trimmedAssistant.slice(0, ASSISTANT_MAX_LEN)}\n`;

    appendFileSync(filePath, entry, 'utf-8');

    // Trigger incremental vector indexing (fire-and-forget)
    indexSource(`memory/${dateStr}.md`, filePath).catch((err) => {
      console.warn('[DailyWriter] Vector index update failed (non-fatal):', err);
    });
  } catch (err) {
    console.warn('[DailyWriter] Failed to append daily memory (non-fatal):', err);
  }
}
