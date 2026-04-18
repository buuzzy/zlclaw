/**
 * Compaction Engine — summarizes old conversation messages.
 *
 * Supports chunked compression for long conversations:
 * 1. Split messages into chunks (≤ MAX_CHUNK_TOKENS each)
 * 2. Summarize each chunk independently
 * 3. Merge partial summaries into a final summary
 *
 * Preserves all identifiers (paths, URLs, IDs, hostnames, etc.)
 * following OpenClaw's strict identifier preservation policy.
 */

import type { CompactionSummary } from './session-store';
import type { StoredCompaction } from './compaction-store';
import { getProviderManager } from '@/shared/provider/manager';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CompactionConfig {
  reserveTokensFloor: number;
  keepRecentMessages: number;
  identifierInstructions?: string;
  timeoutMs: number;
  /** Max tokens per chunk for chunked compression */
  maxChunkTokens: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  reserveTokensFloor: 16000,
  keepRecentMessages: 6,
  identifierInstructions: '',
  timeoutMs: 60_000,
  maxChunkTokens: 8000,
};

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tokenEstimate: number;
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERNS = [
  /(?:\/[\w.-]+){2,}/g,
  /~\/[\w./-]+/g,
  /https?:\/\/\S+/g,
  /\b[a-zA-Z]:\\[\w\\.-]+/g,
  /\b(?:localhost|[\w.-]+\.(?:com|cn|io|dev|app|net|org))(?::\d+)?\b/g,
  /\b[A-Z][A-Z0-9_]{2,}\b/g,
  /\b\d{4,}\b/g,
];

export function extractIdentifiers(messages: SessionMessage[]): string[] {
  const ids = new Set<string>();
  for (const msg of messages) {
    for (const pattern of IDENTIFIER_PATTERNS) {
      const matches = msg.content.match(pattern);
      if (matches) {
        for (const m of matches) {
          if (m.length >= 3 && m.length <= 200) ids.add(m);
        }
      }
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Chunking — split messages into token-bounded chunks
// ---------------------------------------------------------------------------

function chunkMessages(messages: SessionMessage[], maxChunkTokens: number): SessionMessage[][] {
  if (messages.length === 0) return [];

  const chunks: SessionMessage[][] = [];
  let current: SessionMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    if (current.length > 0 && currentTokens + msg.tokenEstimate > maxChunkTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += msg.tokenEstimate;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildChunkSummaryPrompt(
  messages: SessionMessage[],
  identifiers: string[],
  config: CompactionConfig,
  chunkIndex?: number,
  totalChunks?: number,
): string {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const idList = identifiers.length > 0
    ? `\n\n### Identifiers to PRESERVE EXACTLY:\n${identifiers.map((id) => `- \`${id}\``).join('\n')}`
    : '';

  const chunkNote = totalChunks && totalChunks > 1
    ? `\n\nNote: This is chunk ${chunkIndex! + 1} of ${totalChunks}. Summarize only this portion.`
    : '';

  const extra = config.identifierInstructions
    ? `\n\n### Additional preservation rules:\n${config.identifierInstructions}`
    : '';

  return `You are a conversation summarizer. Compress the following conversation into a structured summary.

## Rules:
1. Preserve ALL file paths, URLs, hostnames, port numbers, API keys, model names, stock codes, and numeric IDs EXACTLY as they appear.
2. Preserve the user's stated intent, preferences, and decisions.
3. Preserve ongoing task context: what has been done, what remains, current state.
4. Preserve tool names and their results.
5. Use structured sections: "## Context", "## Completed Tasks", "## Current State", "## Key Identifiers".
6. Output ONLY the summary. No preamble.
7. Target length: 300-800 words.${idList}${extra}${chunkNote}

---
## Conversation to summarize:

${conversation}`;
}

const MERGE_PROMPT = `You are a conversation summarizer. Merge these partial summaries into a single cohesive summary.

MUST PRESERVE:
- Active tasks and their current status (in-progress, blocked, pending)
- Batch operation progress (e.g., '5/17 items completed')
- The last thing the user requested and what was being done about it
- Decisions made and their rationale
- TODOs, open questions, and constraints
- Any commitments or follow-ups promised
- ALL identifiers (paths, URLs, IDs, stock codes, hostnames) exactly as written

PRIORITIZE recent context over older history.
Use structured sections: "## Context", "## Completed Tasks", "## Current State", "## Key Identifiers".
Output ONLY the merged summary.

---
## Partial summaries to merge:

`;

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

async function callLLM(prompt: string, config: CompactionConfig): Promise<string> {
  const manager = getProviderManager();
  const agentCfg = manager.getConfig().agent?.config as Record<string, unknown> | undefined;

  const apiKey = (agentCfg?.apiKey as string)
    || process.env.ANTHROPIC_API_KEY
    || process.env.OPENAI_API_KEY;
  const baseUrl = (agentCfg?.baseUrl as string)
    || process.env.ANTHROPIC_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://api.anthropic.com';
  const model = (agentCfg?.model as string)
    || process.env.AGENT_MODEL
    || 'claude-sonnet-4-20250514';
  const apiType = (agentCfg?.apiType as string) || 'openai-completions';

  if (!apiKey) {
    throw new Error('No API key configured for compaction');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const needsV1 = !normalizedBase.endsWith('/v1');
    const url = apiType === 'anthropic-messages'
      ? `${normalizedBase}${needsV1 ? '/v1' : ''}/messages`
      : `${normalizedBase}${needsV1 ? '/v1' : ''}/chat/completions`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: string;

    if (apiType === 'anthropic-messages') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model, max_tokens: 2000,
        messages: [
          { role: 'system', content: 'You are a precise conversation summarizer. Follow instructions exactly.' },
          { role: 'user', content: prompt },
        ],
      });
    }

    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Compaction API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = await res.json() as Record<string, unknown>;

    if (apiType === 'anthropic-messages') {
      const content = json.content as Array<{ type: string; text?: string }>;
      return content?.find((b) => b.type === 'text')?.text || '';
    } else {
      const choices = json.choices as Array<{ message?: { content?: string } }>;
      return choices?.[0]?.message?.content || '';
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compact older messages into a summary with chunked compression.
 *
 * For short conversations: single LLM call.
 * For long conversations: split into chunks, summarize each, merge.
 */
export async function compactMessages(
  messages: SessionMessage[],
  keepRecentCount?: number,
  config?: Partial<CompactionConfig>,
  onProgress?: (message: string) => void,
): Promise<StoredCompaction | null> {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  const keepCount = keepRecentCount ?? cfg.keepRecentMessages;

  if (messages.length <= keepCount) {
    return null;
  }

  const cutoff = messages.length - keepCount;
  const toCompact = messages.slice(0, cutoff);
  const identifiers = extractIdentifiers(toCompact);
  const totalTokens = toCompact.reduce((s, m) => s + m.tokenEstimate, 0);

  console.log(`[Compaction] Compacting ${toCompact.length} messages (${totalTokens} tokens), keeping ${keepCount} recent`);
  console.log(`[Compaction] Extracted ${identifiers.length} identifiers to preserve`);

  let summary: string;

  // Decide: single call or chunked
  const chunks = chunkMessages(toCompact, cfg.maxChunkTokens);

  if (chunks.length <= 1) {
    // Single chunk — direct summarization
    console.log(`[Compaction] Single chunk (${totalTokens} tokens)`);
    onProgress?.(`⏳ 正在压缩上下文（${toCompact.length} 条消息）...`);
    const prompt = buildChunkSummaryPrompt(toCompact, identifiers, cfg);
    summary = await callLLM(prompt, cfg);
  } else {
    // Multiple chunks — summarize each, then merge
    console.log(`[Compaction] Chunked compression: ${chunks.length} chunks`);
    onProgress?.(`⏳ 对话较长，分 ${chunks.length} 段压缩...`);
    const partialSummaries: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkIds = extractIdentifiers(chunks[i]);
      const allIds = [...new Set([...identifiers, ...chunkIds])];
      const prompt = buildChunkSummaryPrompt(chunks[i], allIds, cfg, i, chunks.length);
      console.log(`[Compaction] Summarizing chunk ${i + 1}/${chunks.length} (${chunks[i].length} messages)`);
      onProgress?.(`⏳ 压缩中（${i + 1}/${chunks.length}）...`);
      const partial = await callLLM(prompt, cfg);
      if (partial) partialSummaries.push(partial);
    }

    if (partialSummaries.length === 0) {
      console.warn('[Compaction] All chunks returned empty summaries');
      return null;
    }

    if (partialSummaries.length === 1) {
      summary = partialSummaries[0];
    } else {
      // Merge partial summaries
      console.log(`[Compaction] Merging ${partialSummaries.length} partial summaries`);
      onProgress?.(`⏳ 正在合并 ${partialSummaries.length} 段摘要...`);
      const mergePrompt = MERGE_PROMPT + partialSummaries.map((s, i) => `### Part ${i + 1}\n${s}`).join('\n\n');
      summary = await callLLM(mergePrompt, cfg);
    }
  }

  if (!summary) {
    console.warn('[Compaction] Model returned empty summary');
    return null;
  }

  const result: StoredCompaction = {
    summary,
    compactedUpTo: cutoff,
    tokenEstimate: estimateTokens(summary),
    createdAt: new Date().toISOString(),
    identifiers,
  };

  console.log(`[Compaction] Summary generated: ${result.tokenEstimate} tokens (from ${totalTokens} tokens, ${((1 - result.tokenEstimate / totalTokens) * 100).toFixed(0)}% reduction)`);
  return result;
}
