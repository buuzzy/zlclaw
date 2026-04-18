/**
 * Channel Trace Logger
 *
 * Writes diagnostic logs to ~/.htclaw/logs/channel-trace.log
 * for debugging message loss in channel adapters.
 *
 * Each log line: [ISO timestamp] [T{node}] {label} | {detail}
 *
 * Usage:
 *   import { traceLog } from '@/shared/utils/trace-logger';
 *   traceLog('T1', 'SDK event received', { messageId, content });
 *
 * Remove this file after debugging is complete.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.htclaw', 'logs');
const LOG_FILE = join(LOG_DIR, 'channel-trace.log');

// Ensure log directory exists on module load
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Write a diagnostic trace line to channel-trace.log.
 *
 * @param node - Trace node ID (e.g. 'T1', 'T2', ...)
 * @param label - Short description of the checkpoint
 * @param detail - Additional data (will be JSON.stringify'd if object)
 */
export function traceLog(node: string, label: string, detail?: unknown): void {
  const ts = new Date().toISOString();
  const detailStr = detail === undefined
    ? ''
    : typeof detail === 'string'
      ? detail
      : JSON.stringify(detail);

  const line = `[${ts}] [${node}] ${label} | ${detailStr}\n`;

  try {
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Silently ignore write errors — diagnostics should never break the app
  }
}
