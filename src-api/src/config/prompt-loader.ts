/**
 * HT Claw Prompt Loader
 *
 * Loads SOUL.md, AGENTS.md, and memory files from ~/.htclaw/
 * and provides them as system prompt fragments for the Agent runtime.
 *
 * When a vector index is available, long-term and daily memory are
 * retrieved via semantic search instead of full-text injection.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { getAppDir } from '@/config/constants';
import { getEmbeddingProvider } from '@/shared/memory/embedding-provider';
import { hybridSearch } from '@/shared/memory/search';
import { loadIndex } from '@/shared/memory/vector-store';

let cachedSoulPrompt: string | null = null;
let cachedAgentsPrompt: string | null = null;

async function loadFile(filename: string): Promise<string> {
  const filePath = join(getAppDir(), filename);
  if (!existsSync(filePath)) return '';
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`[PromptLoader] Failed to load ${filename}:`, error);
    return '';
  }
}

export async function getSoulPrompt(): Promise<string> {
  if (cachedSoulPrompt === null) {
    cachedSoulPrompt = await loadFile('SOUL.md');
  }
  return cachedSoulPrompt;
}

export async function getAgentsPrompt(): Promise<string> {
  if (cachedAgentsPrompt === null) {
    cachedAgentsPrompt = await loadFile('AGENTS.md');
  }
  return cachedAgentsPrompt;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Check whether vector search is operational (config + non-empty index).
 */
function isVectorSearchReady(): boolean {
  const provider = getEmbeddingProvider();
  if (!provider) return false;
  const index = loadIndex();
  return !!index && index.chunks.length > 0;
}

/**
 * Load memory via vector semantic search.
 * user.md is still injected in full (small, always relevant).
 */
async function loadMemoryViaSearch(userQuery?: string): Promise<string> {
  const parts: string[] = [];

  // user.md: always full inject
  const userProfile = await loadFile('user.md');
  if (userProfile.trim()) {
    parts.push(`## User Profile\n${userProfile.trim()}`);
  }

  // Semantic search for relevant memory chunks
  if (userQuery) {
    const provider = getEmbeddingProvider();
    try {
      const results = await hybridSearch(userQuery, provider, {
        maxResults: 8,
        minScore: 0.15,
      });

      if (results.length > 0) {
        const snippets = results.map(
          (r) => `- [${r.source}] (score: ${r.score.toFixed(2)})\n${r.text}`
        );
        parts.push(`## Relevant Memory\n${snippets.join('\n\n---\n\n')}`);
      }
    } catch (err) {
      console.warn('[PromptLoader] Vector search failed, using fallback:', err);
      return loadMemoryFullText();
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
}

/**
 * Load memory by reading full text (original behaviour, used as fallback).
 */
async function loadMemoryFullText(): Promise<string> {
  const appDir = getAppDir();
  const parts: string[] = [];

  const userProfile = await loadFile('user.md');
  if (userProfile.trim()) {
    parts.push(`## User Profile\n${userProfile.trim()}`);
  }

  const memory = await loadFile('MEMORY.md');
  if (memory.trim()) {
    parts.push(`## Long-term Memory\n${memory.trim()}`);
  }

  const memDir = join(appDir, 'memory');
  if (existsSync(memDir)) {
    const recentDates = [todayStr(), yesterdayStr()];
    const recentNotes: string[] = [];

    for (const dateStr of recentDates) {
      const fpath = join(memDir, `${dateStr}.md`);
      if (existsSync(fpath)) {
        try {
          const content = await readFile(fpath, 'utf-8');
          if (content.trim()) {
            recentNotes.push(`### ${dateStr}\n${content.trim()}`);
          }
        } catch { /* skip */ }
      }
    }

    if (recentNotes.length > 0) {
      parts.push(`## Recent Context\n${recentNotes.join('\n\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
}

/**
 * Returns the combined HT Claw system prompt (SOUL + AGENTS + Memory).
 *
 * @param userQuery - when provided and vector search is ready, memory is
 *   retrieved semantically instead of full-text injected.
 */
export async function getHTClawSystemPrompt(userQuery?: string): Promise<string> {
  const [soul, agents] = await Promise.all([
    getSoulPrompt(),
    getAgentsPrompt(),
  ]);

  const memoryCtx = (userQuery && isVectorSearchReady())
    ? await loadMemoryViaSearch(userQuery)
    : await loadMemoryFullText();

  const parts: string[] = [];
  if (soul) parts.push(soul);
  if (agents) parts.push(agents);
  if (memoryCtx) parts.push(memoryCtx);

  return parts.length > 0 ? parts.join('\n\n---\n\n') + '\n\n---\n\n' : '';
}

export function invalidateCache(): void {
  cachedSoulPrompt = null;
  cachedAgentsPrompt = null;
}
