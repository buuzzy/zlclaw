/**
 * Memory Consolidator (F25)
 *
 * Nightly job that distills raw daily memory files into long-term MEMORY.md.
 *
 * Flow:
 *   1. Scan ~/.sage/memory/ for daily files older than CONSOLIDATE_AFTER_DAYS
 *      that have not yet been marked as consolidated.
 *   2. For each file, call the LLM to extract: user preferences, tracked assets,
 *      important conclusions, and notable query patterns.
 *   3. Append the distilled summary under a "## Daily Summary" section in MEMORY.md.
 *   4. Write a marker file (.YYYY-MM-DD.consolidated) to prevent re-processing.
 *   5. Trigger incremental re-index of MEMORY.md so the vector store stays current.
 *   6. After daily consolidation, check if MEMORY.md has grown beyond
 *      META_CONSOLIDATE_THRESHOLD entries — if so, run meta-consolidation to
 *      compress the entire file into a single authoritative summary.
 *
 * The consolidation is idempotent — marker files ensure safety even if the job
 * fires multiple times (e.g. after a crash-restart).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync, copyFileSync } from 'fs';
import { join } from 'path';

import { getAppDir } from '@/config/constants';
import { getProviderManager } from '@/shared/provider/manager';
import { indexSource } from './indexer';
import { loadIndex, saveIndex, removeBySource } from './vector-store';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Only consolidate files older than N days (avoids consolidating today/yesterday mid-flow) */
const CONSOLIDATE_AFTER_DAYS = 1;

/** Timeout for each LLM summarisation call */
const LLM_TIMEOUT_MS = 60_000;

/**
 * When MEMORY.md accumulates more than this many daily-summary sections,
 * trigger a meta-consolidation pass to compress the file.
 * ~60 entries ≈ 2 months of daily use.
 */
const META_CONSOLIDATE_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// User profile helpers
// ---------------------------------------------------------------------------

/** Read ~/.sage/user.md and return as a context block, or empty string if not found */
function getUserProfileContext(): string {
  try {
    const userMdPath = join(getAppDir(), 'user.md');
    if (!existsSync(userMdPath)) return '';
    const content = readFileSync(userMdPath, 'utf-8').trim();
    if (!content) return '';
    return `\n\n[User Profile — use this to personalise the extraction]\n${content}\n`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CONSOLIDATE_PROMPT = `You are a financial AI assistant helping to maintain long-term user memory.

Below is a log of conversations from a single day. Extract concise, structured insights that should be remembered long-term.

Focus on:
1. **User Preferences** — communication style, preferred markets (A-share / HK / US), risk appetite, favorite indicators
2. **Tracked Assets** — specific stocks, ETFs, sectors, indices the user mentioned or asked about
3. **Key Conclusions** — important market insights, analysis conclusions, decisions made
4. **Query Patterns** — recurring topics, data types they often query (K-line, financial data, news, etc.)

Output format (MUST follow exactly):

### 用户偏好
- <bullet points, or "无" if none found>

### 关注标的
- <bullet points: 代码 名称 原因, or "无">

### 重要结论
- <bullet points, or "无">

### 查询偏好
- <bullet points, or "无">

Rules:
- Be concise. Each bullet ≤ 30 words.
- Skip trivial greetings or test queries.
- Use Chinese for output (same language as the memory system).
- Output ONLY the four sections above. No preamble, no extra text.

---
Daily conversation log:

`;

const META_CONSOLIDATE_PROMPT = `You are a financial AI assistant maintaining a user's long-term memory file.

The file below contains many daily summaries accumulated over months. Your task is to compress them into a single, authoritative long-term profile by:
- Merging duplicate or similar preferences into one clear statement
- Keeping only assets the user has shown sustained interest in (mentioned 2+ times or recently)
- Removing conclusions that are clearly outdated or contradicted by later entries
- Summarising recurring query patterns into concise habits

Output format (MUST follow exactly — output ONLY these four sections, nothing else):

### 用户偏好
- <merged bullet points, or "无">

### 长期关注标的
- <sustained interests only: 代码 名称 关注原因, or "无">

### 核心结论
- <important and still-relevant conclusions, or "无">

### 查询习惯
- <recurring patterns, or "无">

Rules:
- Each bullet ≤ 40 words.
- Use Chinese.
- Do NOT include dates or "as of X" qualifiers — write timeless facts about the user.
- Output ONLY the four sections above.

---
Full memory file to compress:

`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMemoryDir(): string {
  return join(getAppDir(), 'memory');
}

function getMemoryFilePath(): string {
  return join(getAppDir(), 'MEMORY.md');
}

function markerPath(date: string): string {
  return join(getMemoryDir(), `.${date}.consolidated`);
}

/** Parse YYYY-MM-DD from filename like "2025-04-15.md" */
function parseDateFromFilename(filename: string): string | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  return m ? m[1] : null;
}

/** Return today's date string YYYY-MM-DD in local time */
function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Return how many days ago a date string is (positive = past) */
function daysAgo(dateStr: string): number {
  const then = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

/** Count how many daily-summary sections exist in MEMORY.md */
function countDailySections(content: string): number {
  const matches = content.match(/^## \d{4}-\d{2}-\d{2} 每日归纳/gm);
  return matches?.length ?? 0;
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

async function callLLM(prompt: string, maxTokens = 800): Promise<string> {
  const manager = getProviderManager();
  const agentCfg = manager.getConfig().agent?.config as Record<string, unknown> | undefined;

  const apiKey = (agentCfg?.apiKey as string)
    || process.env.ANTHROPIC_API_KEY
    || process.env.OPENAI_API_KEY;
  const rawBaseUrl = (agentCfg?.baseUrl as string)
    || process.env.ANTHROPIC_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://api.anthropic.com';
  // Strip trailing '#' — some proxy configs use it as a routing marker
  // that the agent SDK handles internally, but raw fetch calls must not include it.
  const baseUrl = rawBaseUrl.replace(/#.*$/, '').replace(/\/$/, '');
  const model = (agentCfg?.model as string)
    || process.env.AGENT_MODEL
    || 'claude-sonnet-4-20250514';
  const apiType = (agentCfg?.apiType as string) || 'openai-completions';

  if (!apiKey) {
    throw new Error('[Consolidator] No API key configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    let res: Response;

    if (apiType === 'anthropic') {
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic API ${res.status}: ${text}`);
      }

      const json = await res.json() as { content?: Array<{ text?: string }> };
      return json.content?.[0]?.text?.trim() ?? '';
    } else {
      // openai-completions (default)
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI API ${res.status}: ${text}`);
      }

      const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content?.trim() ?? '';
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Remove marker files older than MARKER_RETENTION_DAYS */
const MARKER_RETENTION_DAYS = 30;

function cleanupOldMarkers(memDir: string): void {
  try {
    const files = readdirSync(memDir);
    for (const file of files) {
      const m = file.match(/^\.(\d{4}-\d{2}-\d{2})\.consolidated$/);
      if (!m) continue;
      if (daysAgo(m[1]) > MARKER_RETENTION_DAYS) {
        try {
          unlinkSync(join(memDir, file));
          console.log(`[Consolidator] Removed old marker: ${file}`);
        } catch (e) {
          console.warn(`[Consolidator] Could not remove marker ${file}:`, e);
        }
      }
    }
  } catch (e) {
    console.warn('[Consolidator] Marker cleanup failed (non-fatal):', e);
  }
}

// ---------------------------------------------------------------------------
// Meta-consolidation
// ---------------------------------------------------------------------------

/**
 * If MEMORY.md has grown beyond META_CONSOLIDATE_THRESHOLD daily sections,
 * compress the entire file into a single authoritative long-term profile.
 *
 * A backup is written to MEMORY.md.bak before any changes.
 * Returns true if meta-consolidation ran, false if skipped.
 */
async function maybeMetaConsolidate(): Promise<boolean> {
  const memoryFile = getMemoryFilePath();
  if (!existsSync(memoryFile)) return false;

  let content: string;
  try {
    content = readFileSync(memoryFile, 'utf-8');
  } catch {
    return false;
  }

  const sectionCount = countDailySections(content);
  if (sectionCount < META_CONSOLIDATE_THRESHOLD) {
    console.log(`[Consolidator] MEMORY.md has ${sectionCount} sections (threshold: ${META_CONSOLIDATE_THRESHOLD}), skipping meta-consolidation`);
    return false;
  }

  console.log(`[Consolidator] MEMORY.md has ${sectionCount} sections — triggering meta-consolidation...`);

  // Write backup before any destructive operation
  const backupPath = memoryFile + '.bak';
  try {
    copyFileSync(memoryFile, backupPath);
    console.log(`[Consolidator] Backup written to MEMORY.md.bak`);
  } catch (err) {
    console.error('[Consolidator] Failed to write backup, aborting meta-consolidation:', err);
    return false;
  }

  // Call LLM with larger token budget for full-file compression
  let compressed: string;
  try {
    compressed = await callLLM(META_CONSOLIDATE_PROMPT + content, 2000);
    if (!compressed) throw new Error('LLM returned empty result');
  } catch (err) {
    console.error('[Consolidator] Meta-consolidation LLM call failed:', err);
    return false;
  }

  // Rewrite MEMORY.md with compressed content + provenance header
  const today = todayString();
  const newContent = `> 最后元归纳：${today}（压缩了 ${sectionCount} 条每日归纳，原始备份：MEMORY.md.bak）\n\n${compressed}\n`;

  try {
    writeFileSync(memoryFile, newContent, 'utf-8');
    console.log(`[Consolidator] MEMORY.md compressed from ${sectionCount} sections into unified profile`);
  } catch (err) {
    console.error('[Consolidator] Failed to write compressed MEMORY.md:', err);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Core consolidation
// ---------------------------------------------------------------------------

export interface ConsolidationResult {
  processed: string[];   // date strings successfully consolidated
  skipped: string[];     // already consolidated
  failed: string[];      // errors
  metaConsolidated: boolean; // whether meta-consolidation ran this cycle
}

/**
 * Consolidate all eligible daily memory files.
 * Called by the nightly cron job or the manual API endpoint.
 */
export async function consolidateDailyMemory(): Promise<ConsolidationResult> {
  const result: ConsolidationResult = { processed: [], skipped: [], failed: [], metaConsolidated: false };

  const memDir = getMemoryDir();
  if (!existsSync(memDir)) {
    console.log('[Consolidator] Memory directory not found, nothing to consolidate');
    return result;
  }

  // Clean up stale marker files (>30 days) to prevent indefinite accumulation
  cleanupOldMarkers(memDir);

  // Discover eligible daily files
  let entries: string[];
  try {
    entries = readdirSync(memDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  } catch (err) {
    console.error('[Consolidator] Failed to read memory directory:', err);
    return result;
  }

  for (const filename of entries) {
    const date = parseDateFromFilename(filename);
    if (!date) continue;

    // Skip files that are too recent
    if (daysAgo(date) <= CONSOLIDATE_AFTER_DAYS) {
      continue;
    }

    // Skip if already consolidated
    if (existsSync(markerPath(date))) {
      result.skipped.push(date);
      continue;
    }

    const filePath = join(memDir, filename);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8').trim();
    } catch (err) {
      console.error(`[Consolidator] Failed to read ${filename}:`, err);
      result.failed.push(date);
      continue;
    }

    if (!content) {
      // Empty file — mark as consolidated without LLM call
      writeFileSync(markerPath(date), '');
      result.skipped.push(date);
      continue;
    }

    try {
      console.log(`[Consolidator] Consolidating ${date}...`);
      const userProfileCtx = getUserProfileContext();
      const summary = await callLLM(CONSOLIDATE_PROMPT + userProfileCtx + content);

      if (!summary) {
        throw new Error('LLM returned empty summary');
      }

      // Append to MEMORY.md (ensure parent dir exists first)
      const memoryFile = getMemoryFilePath();
      const entry = `\n\n## ${date} 每日归纳\n\n${summary}\n`;

      mkdirSync(getAppDir(), { recursive: true });
      appendFileSync(memoryFile, entry, 'utf-8');
      console.log(`[Consolidator] Appended summary for ${date} to MEMORY.md`);

      // Write marker to prevent re-processing
      writeFileSync(markerPath(date), new Date().toISOString(), 'utf-8');

      // Graduate: remove daily file's raw chunks from the vector index.
      // The distilled content is now in MEMORY.md — no need to keep raw chunks.
      try {
        const dailySource = `memory/${date}.md`;
        const index = loadIndex();
        if (index) {
          const updated = removeBySource(index, dailySource);
          if (updated.chunks.length < index.chunks.length) {
            saveIndex(updated);
            console.log(`[Consolidator] Graduated ${index.chunks.length - updated.chunks.length} raw chunks from ${dailySource}`);
          }
        }
      } catch (err) {
        console.warn(`[Consolidator] Failed to graduate chunks for ${date} (non-fatal):`, err);
      }

      result.processed.push(date);
    } catch (err) {
      console.error(`[Consolidator] Failed to consolidate ${date}:`, err);
      result.failed.push(date);
    }
  }

  // Re-index MEMORY.md if daily consolidation wrote anything
  if (result.processed.length > 0) {
    const memoryFile = getMemoryFilePath();
    try {
      await indexSource('MEMORY.md', memoryFile);
      console.log('[Consolidator] MEMORY.md re-indexed after daily consolidation');
    } catch (err) {
      console.warn('[Consolidator] Re-index failed (non-fatal):', err);
    }
  }

  // Meta-consolidation: compress MEMORY.md if it has grown too large
  try {
    result.metaConsolidated = await maybeMetaConsolidate();
    if (result.metaConsolidated) {
      // Re-index the compressed MEMORY.md
      const memoryFile = getMemoryFilePath();
      await indexSource('MEMORY.md', memoryFile);
      console.log('[Consolidator] MEMORY.md re-indexed after meta-consolidation');
    }
  } catch (err) {
    console.warn('[Consolidator] Meta-consolidation failed (non-fatal):', err);
  }

  console.log(
    `[Consolidator] Done — processed: ${result.processed.length}, ` +
    `skipped: ${result.skipped.length}, failed: ${result.failed.length}` +
    (result.metaConsolidated ? ', meta-consolidated: yes' : '')
  );

  return result;
}
