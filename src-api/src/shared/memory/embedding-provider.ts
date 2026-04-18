/**
 * Embedding Provider — abstraction + OpenAI-compatible implementation.
 *
 * Any service that exposes `POST /v1/embeddings` (OpenAI, Azure, proxies,
 * self-hosted models) can be used by simply supplying baseUrl + apiKey.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getAppDir } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  provider: string;   // e.g. "openai"
  baseUrl: string;    // e.g. "https://api.openai.com"
  apiKey: string;
  model?: string;     // default "text-embedding-3-small"
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions(): number;
  readonly model: string;
}

// ---------------------------------------------------------------------------
// Config persistence  (~/.htclaw/memory-index/config.json)
// ---------------------------------------------------------------------------

function configDir(): string {
  return join(getAppDir(), 'memory-index');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

export function loadEmbeddingConfig(): EmbeddingConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as EmbeddingConfig;
  } catch {
    return null;
  }
}

export function saveEmbeddingConfig(cfg: EmbeddingConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 64;

/**
 * Normalize user-supplied base URL so callApi can always append `/v1/embeddings`.
 * Handles common mistakes:
 *   "https://api.siliconflow.cn/v1/embeddings" → "https://api.siliconflow.cn"
 *   "https://api.openai.com/v1"               → "https://api.openai.com"
 *   "https://api.openai.com/v1/"              → "https://api.openai.com"
 */
function normalizeBaseUrl(raw: string): string {
  // Strip '#' sentinel (disables auto /v1) — embeddings always need /v1/embeddings,
  // but the '#' just means the user's proxy has a non-standard path structure.
  // We strip it here and still build the canonical path in callApi.
  let url = raw.replace(/#$/, '').replace(/\/+$/, '');
  if (url.endsWith('/v1/embeddings')) {
    url = url.slice(0, -'/v1/embeddings'.length);
  } else if (url.endsWith('/embeddings')) {
    url = url.slice(0, -'/embeddings'.length);
  } else if (url.endsWith('/v1')) {
    url = url.slice(0, -'/v1'.length);
  }
  return url;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private apiKey: string;
  readonly model: string;
  private dims: number;

  constructor(cfg: EmbeddingConfig) {
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    this.apiKey = cfg.apiKey;
    this.model = cfg.model || DEFAULT_MODEL;
    this.dims = 0; // resolved on first call
  }

  dimensions(): number {
    return this.dims;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const vecs = await this.callApi(batch);
      results.push(...vecs);
    }
    return results;
  }

  private async callApi(input: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Embedding API error ${res.status}: ${err}`);
    }

    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to preserve input order
    const sorted = json.data.sort((a, b) => a.index - b.index);
    const vectors = sorted.map((d) => d.embedding);

    if (vectors.length > 0 && this.dims === 0) {
      this.dims = vectors[0].length;
    }

    return vectors;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cachedProvider: EmbeddingProvider | null = null;
let cachedConfigHash = '';

function cfgHash(cfg: EmbeddingConfig): string {
  return `${cfg.baseUrl}|${cfg.apiKey}|${cfg.model ?? ''}`;
}

/**
 * Returns the current EmbeddingProvider, or null if not configured.
 * Caches the instance and recreates only when config changes.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const cfg = loadEmbeddingConfig();
  if (!cfg || !cfg.apiKey) return null;

  const hash = cfgHash(cfg);
  if (cachedProvider && cachedConfigHash === hash) return cachedProvider;

  cachedProvider = new OpenAIEmbeddingProvider(cfg);
  cachedConfigHash = hash;
  return cachedProvider;
}

export function resetEmbeddingProvider(): void {
  cachedProvider = null;
  cachedConfigHash = '';
}
