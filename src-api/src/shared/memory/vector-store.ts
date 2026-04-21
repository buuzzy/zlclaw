/**
 * Vector Store — JSON-based vector storage with cosine similarity search.
 *
 * Stores all chunk embeddings in a single `~/.sage/memory-index/index.json`.
 * Zero external dependencies; suitable for a desktop app's memory scale.
 *
 * Performance optimisation: mtime-based in-process cache avoids re-reading
 * the JSON file on every search call. The cache is invalidated whenever
 * saveIndex() is called (synchronous write → mtime advances).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getAppDir } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredChunk {
  id: string;
  source: string;
  text: string;
  hash: string;
  vector: number[];
  updatedAt: string;
}

export interface VectorIndex {
  version: number;
  model: string;
  dimensions: number;
  indexedAt: string;
  chunks: StoredChunk[];
}

export interface SearchResult {
  id: string;
  source: string;
  text: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function indexDir(): string {
  return join(getAppDir(), 'memory-index');
}

function indexPath(): string {
  return join(indexDir(), 'index.json');
}

// ---------------------------------------------------------------------------
// In-process mtime cache
// ---------------------------------------------------------------------------

interface IndexCache {
  mtime: number;   // ms since epoch
  index: VectorIndex;
}

let _cache: IndexCache | null = null;

/** Invalidate the in-process cache. Called by saveIndex() automatically. */
function invalidateCache(): void {
  _cache = null;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

const CURRENT_VERSION = 1;

function emptyIndex(model: string, dimensions: number): VectorIndex {
  return {
    version: CURRENT_VERSION,
    model,
    dimensions,
    indexedAt: new Date().toISOString(),
    chunks: [],
  };
}

export function loadIndex(): VectorIndex | null {
  const p = indexPath();
  if (!existsSync(p)) {
    invalidateCache();
    return null;
  }

  try {
    // Check mtime — return cached object if file hasn't changed
    const mtime = statSync(p).mtimeMs;
    if (_cache && _cache.mtime === mtime) {
      return _cache.index;
    }

    const data = JSON.parse(readFileSync(p, 'utf-8')) as VectorIndex;
    if (data.version !== CURRENT_VERSION) {
      invalidateCache();
      return null;
    }

    // Update cache
    _cache = { mtime, index: data };
    return data;
  } catch {
    invalidateCache();
    return null;
  }
}

export function saveIndex(index: VectorIndex): void {
  const dir = indexDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(indexPath(), JSON.stringify(index), 'utf-8');
  // Invalidate cache so the next loadIndex() re-reads the fresh file
  invalidateCache();
}

export function deleteIndex(): void {
  const p = indexPath();
  if (existsSync(p)) {
    unlinkSync(p);
  }
  invalidateCache();
}

/**
 * Upsert chunks into the index. Chunks with matching id are replaced.
 */
export function upsertChunks(
  index: VectorIndex,
  chunks: StoredChunk[],
): VectorIndex {
  const idSet = new Set(chunks.map((c) => c.id));
  const kept = index.chunks.filter((c) => !idSet.has(c.id));
  return {
    ...index,
    indexedAt: new Date().toISOString(),
    chunks: [...kept, ...chunks],
  };
}

/**
 * Remove all chunks from a given source file.
 */
export function removeBySource(index: VectorIndex, source: string): VectorIndex {
  return {
    ...index,
    chunks: index.chunks.filter((c) => c.source !== source),
  };
}

/**
 * Vector similarity search. Returns top-K results sorted by descending score.
 */
export function vectorSearch(
  index: VectorIndex,
  queryVector: number[],
  maxResults = 5,
  minScore = 0,
): SearchResult[] {
  const scored = index.chunks.map((chunk) => ({
    id: chunk.id,
    source: chunk.source,
    text: chunk.text,
    score: cosineSimilarity(queryVector, chunk.vector),
  }));

  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export { emptyIndex, cosineSimilarity };
