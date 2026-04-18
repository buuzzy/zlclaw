/**
 * Hybrid Memory Search — combines vector similarity with keyword matching.
 *
 * Scoring: finalScore = alpha * vectorScore + (1 - alpha) * keywordScore
 *
 * Source weighting:
 *   - MEMORY.md chunks get a 1.3x boost (long-term consolidated facts)
 *   - user.md chunks get a 1.2x boost (user profile)
 *   - Daily file chunks are used as-is (recent raw transcripts)
 */

import type { EmbeddingProvider } from './embedding-provider';
import {
  loadIndex,
  vectorSearch,
  type SearchResult,
  type VectorIndex,
} from './vector-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridSearchOptions {
  maxResults?: number;
  minScore?: number;
  alpha?: number;  // weight for vector score (0..1), default 0.7
}

export interface HybridSearchResult extends SearchResult {
  vectorScore: number;
  keywordScore: number;
}

// ---------------------------------------------------------------------------
// Source weight — long-term memory sources get higher priority
// ---------------------------------------------------------------------------

function sourceWeight(source: string): number {
  if (source === 'MEMORY.md') return 1.3;
  if (source === 'user.md') return 1.2;
  return 1.0;  // daily files
}

// ---------------------------------------------------------------------------
// Keyword scoring (simplified BM25-like TF relevance)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function keywordScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const textLower = text.toLowerCase();
  const textTokens = new Set(tokenize(text));

  let hits = 0;
  let phraseBonus = 0;

  for (const qt of queryTokens) {
    if (textTokens.has(qt)) hits++;
  }

  // Bonus for exact phrase match
  const queryLower = query.toLowerCase();
  if (textLower.includes(queryLower)) {
    phraseBonus = 0.3;
  }

  const tokenScore = queryTokens.length > 0 ? hits / queryTokens.length : 0;
  return Math.min(1, tokenScore + phraseBonus);
}

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

/**
 * Perform hybrid search over the memory index.
 * Falls back to keyword-only if no embedding provider is available.
 */
export async function hybridSearch(
  query: string,
  provider: EmbeddingProvider | null,
  opts: HybridSearchOptions = {},
): Promise<HybridSearchResult[]> {
  const { maxResults = 5, minScore = 0.1, alpha = 0.7 } = opts;

  const index = loadIndex();
  if (!index || index.chunks.length === 0) return [];

  // Vector search
  let vecResults: SearchResult[] = [];
  if (provider) {
    try {
      const [queryVec] = await provider.embed([query]);
      vecResults = vectorSearch(index, queryVec, maxResults * 3, 0);
    } catch (err) {
      console.warn('[MemorySearch] Vector search failed, falling back to keyword-only:', err);
    }
  }

  // Build candidate set (union of vector hits + all chunks for keyword)
  const candidateIds = new Set<string>();
  const vecScoreMap = new Map<string, number>();

  for (const r of vecResults) {
    candidateIds.add(r.id);
    vecScoreMap.set(r.id, r.score);
  }

  // If no vector results, score all chunks by keyword
  const candidates = vecResults.length > 0
    ? getCandidateChunks(index, candidateIds)
    : index.chunks;

  const results: HybridSearchResult[] = [];

  for (const chunk of candidates) {
    const vs = vecScoreMap.get(chunk.id) ?? 0;
    const ks = keywordScore(query, chunk.text);
    const raw = alpha * vs + (1 - alpha) * ks;
    const final = Math.min(1, raw * sourceWeight(chunk.source));

    if (final >= minScore) {
      results.push({
        id: chunk.id,
        source: chunk.source,
        text: chunk.text,
        score: final,
        vectorScore: vs,
        keywordScore: ks,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

/**
 * Keyword-only search (no embedding needed).
 */
export function keywordSearch(
  query: string,
  maxResults = 5,
  minScore = 0.1,
): HybridSearchResult[] {
  const index = loadIndex();
  if (!index || index.chunks.length === 0) return [];

  const results: HybridSearchResult[] = [];

  for (const chunk of index.chunks) {
    const ks = keywordScore(query, chunk.text);
    if (ks >= minScore) {
      results.push({
        id: chunk.id,
        source: chunk.source,
        text: chunk.text,
        score: ks,
        vectorScore: 0,
        keywordScore: ks,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCandidateChunks(index: VectorIndex, ids: Set<string>) {
  return index.chunks.filter((c) => ids.has(c.id));
}
