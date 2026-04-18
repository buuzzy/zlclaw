/**
 * Context Assembler — builds conversation context for the model.
 *
 * Non-destructive compaction: original messages are NEVER deleted.
 * Compaction summaries are stored separately in the compaction store.
 *
 * Flow:
 *   1. Check compaction store for existing summary
 *   2. If conversation exceeds token budget → auto-compact
 *   3. Assemble: [summary] + [recent messages within budget]
 *   4. Return formatted context string
 */

import { loadCompaction, saveCompaction, type StoredCompaction } from './compaction-store';
import {
  compactMessages,
  estimateTokens,
  DEFAULT_COMPACTION_CONFIG,
  type SessionMessage,
} from './compaction';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AssemblerConfig {
  maxContextTokens: number;
  keepRecentMessages: number;
}

const DEFAULT_CONFIG: AssemblerConfig = {
  maxContextTokens: 12000,
  keepRecentMessages: 6,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: string;
  content: string;
}

export interface AssembleResult {
  context: string;
  compacted: boolean;
  estimatedTokens: number;
  recentMessageCount: number;
}

// ---------------------------------------------------------------------------
// Core: assemble context from conversation + compaction store
// ---------------------------------------------------------------------------

/**
 * Assemble conversation context for the model.
 *
 * 1. Check if we have a stored compaction for this taskId
 * 2. If conversation grew beyond the compacted range, check token budget
 * 3. If over budget, auto-compact and store result
 * 4. Format: [summary] + [recent messages]
 */
export async function assembleContext(
  taskId: string,
  conversation: ConversationMessage[],
  config?: Partial<AssemblerConfig>,
): Promise<AssembleResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!conversation || conversation.length === 0) {
    return { context: '', compacted: false, estimatedTokens: 0, recentMessageCount: 0 };
  }

  // Load existing compaction
  let compaction = loadCompaction(taskId);
  let compacted = false;

  // Validate compaction alignment: if conversation is shorter than compactedUpTo,
  // the compaction is stale (e.g. user started a new conversation with same taskId,
  // or messages were deleted). Discard it.
  if (compaction && compaction.compactedUpTo > conversation.length) {
    console.warn(`[Assembler] Stale compaction for ${taskId}: compactedUpTo=${compaction.compactedUpTo} > conversation.length=${conversation.length}, discarding`);
    compaction = null;
  }

  // Calculate tokens for messages NOT covered by existing compaction
  const uncoveredStart = compaction ? compaction.compactedUpTo : 0;
  const uncoveredMessages = conversation.slice(uncoveredStart);
  const uncoveredTokens = uncoveredMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
  const summaryTokens = compaction?.tokenEstimate ?? 0;
  const totalTokens = uncoveredTokens + summaryTokens;

  // Auto-compact if over budget
  if (totalTokens > cfg.maxContextTokens && uncoveredMessages.length > cfg.keepRecentMessages) {
    console.log(`[Assembler] Auto-compacting: ${totalTokens} tokens > ${cfg.maxContextTokens} budget (${conversation.length} messages)`);

    try {
      const sessionMessages = conversation.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date().toISOString(),
        tokenEstimate: estimateTokens(m.content),
      }));

      // If we have a previous summary, include it as context for the new compaction
      const result = await compactMessages(sessionMessages, cfg.keepRecentMessages);

      if (result) {
        // If there was a previous compaction, merge the summaries
        if (compaction) {
          result.summary = `[Previous context]\n${compaction.summary}\n\n[Recent context]\n${result.summary}`;
          result.tokenEstimate = estimateTokens(result.summary);
        }

        saveCompaction(taskId, result);
        compaction = result;
        compacted = true;
        console.log(`[Assembler] Auto-compaction complete: ${result.tokenEstimate} tokens summary, covers ${result.compactedUpTo} messages`);
      }
    } catch (err) {
      console.warn('[Assembler] Auto-compaction failed, using truncation fallback:', err);
    }
  }

  // Format context
  const context = formatContext(conversation, compaction, cfg.maxContextTokens);

  return {
    context,
    compacted,
    estimatedTokens: estimateTokens(context),
    recentMessageCount: compaction
      ? conversation.length - compaction.compactedUpTo
      : conversation.length,
  };
}

// ---------------------------------------------------------------------------
// Manual compact (for /compact command) — non-destructive
// ---------------------------------------------------------------------------

export async function manualCompact(
  taskId: string,
  conversation: ConversationMessage[],
  onProgress?: (message: string) => void,
): Promise<{ summary: string; ok: boolean; tokensBefore: number; tokensAfter: number }> {
  if (!conversation || conversation.length < 6) {
    return { summary: '', ok: false, tokensBefore: 0, tokensAfter: 0 };
  }

  const tokensBefore = conversation.reduce((s, m) => s + estimateTokens(m.content), 0);

  try {
    const sessionMessages = conversation.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date().toISOString(),
      tokenEstimate: estimateTokens(m.content),
    }));

    const result = await compactMessages(sessionMessages, DEFAULT_COMPACTION_CONFIG.keepRecentMessages, undefined, onProgress);

    if (result) {
      // Merge with existing compaction if present
      const existing = loadCompaction(taskId);
      if (existing) {
        result.summary = `[Previous context]\n${existing.summary}\n\n[Recent context]\n${result.summary}`;
        result.tokenEstimate = estimateTokens(result.summary);
      }

      saveCompaction(taskId, result);

      const recentTokens = conversation
        .slice(-DEFAULT_COMPACTION_CONFIG.keepRecentMessages)
        .reduce((s, m) => s + estimateTokens(m.content), 0);
      const tokensAfter = result.tokenEstimate + recentTokens;

      return { summary: result.summary, ok: true, tokensBefore, tokensAfter };
    }
  } catch (err) {
    console.error('[Assembler] Manual compaction failed:', err);
  }

  return { summary: '', ok: false, tokensBefore, tokensAfter: tokensBefore };
}

// ---------------------------------------------------------------------------
// Format context string
// ---------------------------------------------------------------------------

function formatContext(
  conversation: ConversationMessage[],
  compaction: StoredCompaction | null,
  maxTokens: number,
): string {
  const parts: string[] = [];

  // Add compaction summary if present
  if (compaction) {
    parts.push('## Conversation Summary (earlier context)\n');
    parts.push(compaction.summary);
    parts.push('\n\n---\n');
  }

  // Determine which messages to include (clamp to valid range)
  const startIndex = compaction ? Math.min(compaction.compactedUpTo, conversation.length) : 0;
  const recentMessages = conversation.slice(startIndex);

  if (recentMessages.length > 0) {
    parts.push('## Recent Conversation\n');

    let tokenBudget = maxTokens - estimateTokens(parts.join(''));
    const recentParts: string[] = [];

    // Work backwards from most recent
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const line = `${role}: ${msg.content}`;
      const lineTokens = estimateTokens(line);

      if (tokenBudget - lineTokens < 0 && recentParts.length >= 2) {
        recentParts.unshift(`[... ${i + 1} earlier messages omitted ...]`);
        break;
      }

      recentParts.unshift(line);
      tokenBudget -= lineTokens;
    }

    parts.push(recentParts.join('\n\n'));
  }

  if (parts.length === 0) return '';

  return parts.join('\n') + '\n\n---\n## Current Request\n';
}
