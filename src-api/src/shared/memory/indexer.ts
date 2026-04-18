/**
 * Memory Indexer — scans memory files, chunks, embeds, and writes the vector index.
 *
 * Supports full rebuild and incremental updates (hash-based change detection).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';

import { getAppDir } from '@/config/constants';
import { getEmbeddingProvider, type EmbeddingProvider } from './embedding-provider';
import { chunkMarkdown, type MemoryChunk } from './chunker';
import {
  loadIndex,
  saveIndex,
  emptyIndex,
  upsertChunks,
  removeBySource,
  type StoredChunk,
  type VectorIndex,
} from './vector-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexStatus {
  configured: boolean;
  indexed: boolean;
  chunkCount: number;
  lastIndexedAt: string | null;
  model: string | null;
  sources: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let indexing = false;

export function isIndexing(): boolean {
  return indexing;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/** Daily files older than this many days are graduated out of the hot index */
export const HOT_LAYER_DAYS = 30;

interface MemoryFile {
  source: string;  // logical name, e.g. "MEMORY.md" or "memory/2025-04-15.md"
  path: string;    // absolute path
}

/** Parse YYYY-MM-DD from a source name like "memory/2025-04-15.md" */
function dailySourceAge(source: string): number | null {
  const m = source.match(/^memory\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (!m) return null;
  const then = new Date(m[1] + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

/** Return true if a daily source is still within the hot layer */
export function isHotSource(source: string): boolean {
  const age = dailySourceAge(source);
  if (age === null) return true;   // MEMORY.md / user.md → always hot
  return age <= HOT_LAYER_DAYS;
}

function discoverMemoryFiles(): MemoryFile[] {
  const appDir = getAppDir();
  const files: MemoryFile[] = [];

  // Top-level memory files — always indexed
  for (const name of ['MEMORY.md', 'user.md']) {
    const p = join(appDir, name);
    if (existsSync(p)) {
      files.push({ source: name, path: p });
    }
  }

  // Daily memory files — only within hot layer (≤ HOT_LAYER_DAYS days old)
  const memDir = join(appDir, 'memory');
  if (existsSync(memDir)) {
    try {
      const entries = readdirSync(memDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
      for (const entry of entries) {
        const source = `memory/${entry}`;
        if (isHotSource(source)) {
          files.push({ source, path: join(memDir, entry) });
        }
      }
    } catch { /* skip */ }
  }

  return files;
}

/**
 * Remove all index chunks whose daily source has aged out of the hot layer.
 * Called during indexAll / indexIfNeeded to keep the index lean.
 */
function evictExpiredDailyChunks(index: VectorIndex): { index: VectorIndex; evicted: number } {
  const before = index.chunks.length;
  const kept = index.chunks.filter((c) => isHotSource(c.source));
  const evicted = before - kept.length;
  if (evicted > 0) {
    console.log(`[MemoryIndex] Evicted ${evicted} chunks from graduated daily files`);
  }
  return { index: { ...index, chunks: kept }, evicted };
}

// ---------------------------------------------------------------------------
// Core indexing
// ---------------------------------------------------------------------------

/**
 * Full reindex — re-chunks and re-embeds all memory files.
 */
export async function indexAll(): Promise<IndexStatus> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    return getIndexStatus();
  }

  indexing = true;
  try {
    console.log('[MemoryIndex] Starting full reindex...');
    const files = discoverMemoryFiles();  // already filtered to hot layer
    const allChunks: MemoryChunk[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const chunks = chunkMarkdown(file.source, content);
        allChunks.push(...chunks);
      } catch (err) {
        console.warn(`[MemoryIndex] Failed to read ${file.source}:`, err);
      }
    }

    console.log(`[MemoryIndex] ${allChunks.length} chunks from ${files.length} files`);

    if (allChunks.length === 0) {
      const idx = emptyIndex(provider.model, 0);
      saveIndex(idx);
      return getIndexStatus();
    }

    const texts = allChunks.map((c) => c.text);
    const vectors = await provider.embed(texts);
    const dims = vectors[0]?.length ?? 0;

    const storedChunks: StoredChunk[] = allChunks.map((c, i) => ({
      ...c,
      vector: vectors[i],
      updatedAt: new Date().toISOString(),
    }));

    const idx = emptyIndex(provider.model, dims);
    idx.chunks = storedChunks;
    saveIndex(idx);

    console.log(`[MemoryIndex] Full reindex complete: ${storedChunks.length} chunks, ${dims}d`);
    return getIndexStatus();
  } finally {
    indexing = false;
  }
}

/**
 * Incremental index — only re-embeds chunks whose hash changed.
 */
export async function indexIfNeeded(): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) return;

  indexing = true;
  try {
    const files = discoverMemoryFiles();  // already filtered to hot layer
    let index = loadIndex();

    if (!index) {
      await indexAll();
      return;
    }

    // Evict chunks from daily files that have graduated out of the hot layer
    const evictResult = evictExpiredDailyChunks(index);
    index = evictResult.index;
    const existingHashes = new Map<string, string>();
    for (const chunk of index.chunks) {
      existingHashes.set(chunk.id, chunk.hash);
    }

    // Track which sources still exist
    const activeSources = new Set(files.map((f) => f.source));

    // Remove chunks from deleted sources
    for (const chunk of index.chunks) {
      if (!activeSources.has(chunk.source)) {
        index = removeBySource(index, chunk.source);
      }
    }

    // Chunk all files, find changes
    const newChunks: MemoryChunk[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        const chunks = chunkMarkdown(file.source, content);
        for (const chunk of chunks) {
          const existing = existingHashes.get(chunk.id);
          if (!existing || existing !== chunk.hash) {
            newChunks.push(chunk);
          }
        }
      } catch { /* skip */ }
    }

    if (newChunks.length === 0) return;

    console.log(`[MemoryIndex] Incremental: ${newChunks.length} changed chunks`);

    const texts = newChunks.map((c) => c.text);
    const vectors = await provider.embed(texts);

    const storedChunks: StoredChunk[] = newChunks.map((c, i) => ({
      ...c,
      vector: vectors[i],
      updatedAt: new Date().toISOString(),
    }));

    index = upsertChunks(index, storedChunks);
    if (index.dimensions === 0 && vectors[0]) {
      index.dimensions = vectors[0].length;
    }
    saveIndex(index);

    console.log(`[MemoryIndex] Incremental complete: ${storedChunks.length} updated`);
  } catch (err) {
    console.warn('[MemoryIndex] Incremental index failed:', err);
  } finally {
    indexing = false;
  }
}

/**
 * Index a single source file (used after appendDailyMemory).
 */
export async function indexSource(source: string, filePath: string): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) return;

  try {
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, 'utf-8');
    const chunks = chunkMarkdown(source, content);
    if (chunks.length === 0) return;

    let index = loadIndex();
    if (!index) {
      index = emptyIndex(provider.model, 0);
    }

    // Check which chunks actually changed
    const existingHashes = new Map<string, string>();
    for (const c of index.chunks) {
      if (c.source === source) existingHashes.set(c.id, c.hash);
    }

    const changed = chunks.filter((c) => {
      const h = existingHashes.get(c.id);
      return !h || h !== c.hash;
    });

    if (changed.length === 0) return;

    const vectors = await provider.embed(changed.map((c) => c.text));
    const stored: StoredChunk[] = changed.map((c, i) => ({
      ...c,
      vector: vectors[i],
      updatedAt: new Date().toISOString(),
    }));

    index = upsertChunks(index, stored);
    if (index.dimensions === 0 && vectors[0]) {
      index.dimensions = vectors[0].length;
    }
    saveIndex(index);
  } catch (err) {
    console.warn(`[MemoryIndex] Failed to index source ${source}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function getIndexStatus(): IndexStatus {
  const provider = getEmbeddingProvider();
  const index = loadIndex();

  const sources = index
    ? [...new Set(index.chunks.map((c) => c.source))]
    : [];

  return {
    configured: !!provider,
    indexed: !!index && index.chunks.length > 0,
    chunkCount: index?.chunks.length ?? 0,
    lastIndexedAt: index?.indexedAt ?? null,
    model: index?.model ?? provider?.model ?? null,
    sources,
  };
}
