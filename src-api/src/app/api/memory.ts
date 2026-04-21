/**
 * Memory API Routes
 *
 * REST endpoints for memory vector search, indexing, and configuration.
 */

import { Hono } from 'hono';

import {
  loadEmbeddingConfig,
  saveEmbeddingConfig,
  resetEmbeddingProvider,
  getEmbeddingProvider,
  OpenAIEmbeddingProvider,
  type EmbeddingConfig,
} from '@/shared/memory/embedding-provider';
import {
  indexAll,
  indexIfNeeded,
  getIndexStatus,
  isIndexing,
} from '@/shared/memory/indexer';
import { hybridSearch, keywordSearch } from '@/shared/memory/search';
import { consolidateDailyMemory } from '@/shared/memory/consolidator';

export const memoryRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /memory/status — index status
// ---------------------------------------------------------------------------

memoryRoutes.get('/status', (c) => {
  const status = getIndexStatus();
  return c.json({ ...status, indexing: isIndexing() });
});

// ---------------------------------------------------------------------------
// GET /memory/config — current embedding config (apiKey masked)
// ---------------------------------------------------------------------------

memoryRoutes.get('/config', (c) => {
  const cfg = loadEmbeddingConfig();
  if (!cfg) return c.json({ configured: false });

  return c.json({
    configured: true,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKeyMasked: cfg.apiKey
      ? cfg.apiKey.slice(0, 6) + '...' + cfg.apiKey.slice(-4)
      : null,
  });
});

// ---------------------------------------------------------------------------
// POST /memory/config — save embedding config
// ---------------------------------------------------------------------------

interface ConfigBody {
  provider?: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

memoryRoutes.post('/config', async (c) => {
  const body = await c.req.json<ConfigBody>();

  if (!body.baseUrl || !body.apiKey) {
    return c.json({ error: 'baseUrl and apiKey are required' }, 400);
  }

  const cfg: EmbeddingConfig = {
    provider: body.provider || 'openai',
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    model: body.model || 'text-embedding-3-small',
  };

  saveEmbeddingConfig(cfg);
  resetEmbeddingProvider();

  return c.json({ ok: true, message: 'Embedding config saved' });
});

// ---------------------------------------------------------------------------
// POST /memory/config/test — test embedding config with a sample text
// ---------------------------------------------------------------------------

memoryRoutes.post('/config/test', async (c) => {
  const body = await c.req.json<ConfigBody>();

  if (!body.baseUrl || !body.apiKey) {
    return c.json({ error: 'baseUrl and apiKey are required' }, 400);
  }

  try {
    const provider = new OpenAIEmbeddingProvider({
      provider: body.provider || 'openai',
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      model: body.model || 'text-embedding-3-small',
    });

    const testText = 'Sage memory search test';
    const [vec] = await provider.embed([testText]);

    return c.json({
      ok: true,
      dimensions: vec.length,
      model: provider.model,
      message: `Connection successful. Dimensions: ${vec.length}`,
    });
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /memory/index — trigger full reindex
// ---------------------------------------------------------------------------

memoryRoutes.post('/index', async (c) => {
  if (isIndexing()) {
    return c.json({ ok: false, error: 'Indexing already in progress' }, 409);
  }

  const provider = getEmbeddingProvider();
  if (!provider) {
    return c.json({ ok: false, error: 'Embedding provider not configured' }, 400);
  }

  try {
    const status = await indexAll();
    return c.json({ ok: true, ...status });
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Indexing failed',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /memory/search — semantic search
// ---------------------------------------------------------------------------

interface SearchBody {
  query: string;
  maxResults?: number;
  minScore?: number;
}

memoryRoutes.post('/search', async (c) => {
  const body = await c.req.json<SearchBody>();

  if (!body.query) {
    return c.json({ error: 'query is required' }, 400);
  }

  const provider = getEmbeddingProvider();

  try {
    const results = provider
      ? await hybridSearch(body.query, provider, {
          maxResults: body.maxResults,
          minScore: body.minScore,
        })
      : keywordSearch(body.query, body.maxResults, body.minScore);

    return c.json({ ok: true, results });
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Search failed',
      results: [],
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /memory/consolidate — manually trigger daily memory consolidation
// ---------------------------------------------------------------------------

memoryRoutes.post('/consolidate', async (c) => {
  try {
    console.log('[Memory API] Manual consolidation triggered');
    const result = await consolidateDailyMemory();
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Consolidation failed',
    }, 500);
  }
});
