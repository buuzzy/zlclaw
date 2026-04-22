/**
 * Provider Management API Routes
 *
 * Provides REST endpoints for managing sandbox and agent providers.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Hono } from 'hono';

import { getAgentRegistry } from '@/core/agent/registry';
import { getSandboxRegistry } from '@/core/sandbox/registry';
import { getConfigLoader } from '@/config/loader';
import { getProviderManager } from '@/shared/provider/manager';
import { getConfigPath } from '@/shared/utils/paths';
import { buildEndpointUrl } from '@/shared/utils/url';

// ============================================================================
// Constants
// ============================================================================

const API_TIMEOUT_MS = 60000;
const DEFAULT_TEST_MODEL = 'gpt-3.5-turbo';
const DETECT_TEST_MESSAGE = 'OK';

// ============================================================================
// Types
// ============================================================================

interface ProviderSwitchBody {
  type: string;
  config?: Record<string, unknown>;
}

interface ProviderMetadataWithStatus {
  type: string;
  name: string;
  description: string;
  available: boolean;
  current: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatProviderMetadata(
  metadata: Array<{ type: string; name: string; description?: string }>,
  availableTypes: string[],
  currentType: string | null
): ProviderMetadataWithStatus[] {
  return metadata.map((m) => ({
    ...m,
    description: m.description || '',
    available: availableTypes.includes(m.type),
    current: currentType === m.type,
  }));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

// ============================================================================
// Routes
// ============================================================================

const providersRoutes = new Hono();

// Global error handler for providers routes
providersRoutes.onError((err, c) => {
  console.error('[ProvidersAPI] Unhandled error:', err);
  return c.json(
    { error: err instanceof Error ? err.message : 'Internal server error' },
    500
  );
});

// ----------------------------------------------------------------------------
// Sandbox Provider Routes
// ----------------------------------------------------------------------------

/**
 * GET /providers/sandbox
 * List all sandbox providers with their metadata
 */
providersRoutes.get('/sandbox', async (c) => {
  const registry = getSandboxRegistry();
  const manager = getProviderManager();

  const metadata = registry.getAllSandboxMetadata();
  const available = await registry.getAvailable();
  const currentType = manager.getConfig().sandbox?.type || null;

  const providers = formatProviderMetadata(metadata, available, currentType);

  return c.json({ providers, current: currentType });
});

/**
 * GET /providers/sandbox/available
 * List available sandbox providers (those that can actually run on this system)
 */
providersRoutes.get('/sandbox/available', async (c) => {
  const registry = getSandboxRegistry();
  const available = await registry.getAvailable();
  return c.json({ available });
});

/**
 * GET /providers/sandbox/:type
 * Get details about a specific sandbox provider
 */
providersRoutes.get('/sandbox/:type', async (c) => {
  const type = c.req.param('type');
  const registry = getSandboxRegistry();
  const metadata = registry.getSandboxMetadata(type);

  if (!metadata) {
    return c.json({ error: `Sandbox provider not found: ${type}` }, 404);
  }

  const available = await registry.getAvailable();
  const currentType = getProviderManager().getConfig().sandbox?.type;

  return c.json({
    ...metadata,
    available: available.includes(type),
    current: currentType === type,
  });
});

/**
 * POST /providers/sandbox/switch
 * Switch to a different sandbox provider
 */
providersRoutes.post('/sandbox/switch', async (c) => {
  const body = await c.req.json<ProviderSwitchBody>();

  if (!body.type) {
    return c.json({ error: 'Provider type is required' }, 400);
  }

  const manager = getProviderManager();
  await manager.switchSandboxProvider(body.type, body.config);

  getConfigLoader().updateFromSettings({
    sandboxProvider: body.type,
    sandboxConfig: body.config,
  });

  return c.json({
    success: true,
    current: body.type,
    message: `Switched to sandbox provider: ${body.type}`,
  });
});

// ----------------------------------------------------------------------------
// Agent Provider Routes
// ----------------------------------------------------------------------------

/**
 * GET /providers/agents
 * List all agent providers with their metadata
 */
providersRoutes.get('/agents', async (c) => {
  const registry = getAgentRegistry();
  const manager = getProviderManager();

  const metadata = registry.getAllAgentMetadata();
  const available = await registry.getAvailable();
  const currentType = manager.getConfig().agent?.type || null;

  const providers = formatProviderMetadata(metadata, available, currentType);

  return c.json({ providers, current: currentType });
});

/**
 * GET /providers/agents/available
 * List available agent providers
 */
providersRoutes.get('/agents/available', async (c) => {
  const registry = getAgentRegistry();
  const available = await registry.getAvailable();
  return c.json({ available });
});

/**
 * GET /providers/agents/:type
 * Get details about a specific agent provider
 */
providersRoutes.get('/agents/:type', async (c) => {
  const type = c.req.param('type');
  const registry = getAgentRegistry();
  const metadata = registry.getAgentMetadata(type);

  if (!metadata) {
    return c.json({ error: `Agent provider not found: ${type}` }, 404);
  }

  const available = await registry.getAvailable();
  const currentType = getProviderManager().getConfig().agent?.type;

  return c.json({
    ...metadata,
    available: available.includes(type),
    current: currentType === type,
  });
});

/**
 * POST /providers/agents/switch
 * Switch to a different agent provider
 */
providersRoutes.post('/agents/switch', async (c) => {
  const body = await c.req.json<ProviderSwitchBody>();

  if (!body.type) {
    return c.json({ error: 'Provider type is required' }, 400);
  }

  const manager = getProviderManager();
  await manager.switchAgentProvider(body.type, body.config);

  getConfigLoader().updateFromSettings({
    agentProvider: body.type,
    agentConfig: body.config,
  });

  return c.json({
    success: true,
    current: body.type,
    message: `Switched to agent provider: ${body.type}`,
  });
});

// ----------------------------------------------------------------------------
// Settings Routes
// ----------------------------------------------------------------------------

interface SettingsSyncBody {
  sandboxProvider?: string;
  sandboxConfig?: Record<string, unknown>;
  agentProvider?: string;
  agentConfig?: Record<string, unknown>;
  defaultProvider?: string;
  defaultModel?: string;
}

/**
 * POST /providers/settings/sync
 * Sync frontend settings with the backend
 */
providersRoutes.post('/settings/sync', async (c) => {
  const body = await c.req.json<SettingsSyncBody>();

  const manager = getProviderManager();
  const configLoader = getConfigLoader();

  if (body.sandboxProvider) {
    await manager.switchSandboxProvider(body.sandboxProvider, body.sandboxConfig);
  }

  if (body.agentProvider) {
    await manager.switchAgentProvider(body.agentProvider, body.agentConfig);
  }

  configLoader.updateFromSettings({
    ...body,
    agentConfig: body.agentConfig,
  });

  // Persist agentConfig to config.json so it survives restarts
  // This ensures channel adapters (Feishu, WeChat) can load model config
  // without waiting for the frontend to sync
  if (body.agentConfig) {
    try {
      const configPath = getConfigPath();
      let fileConfig: Record<string, unknown> = {};
      try {
        if (existsSync(configPath)) {
          fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        }
      } catch {
        // ignore parse errors, start fresh
      }

      fileConfig.agentConfig = {
        apiKey: body.agentConfig.apiKey,
        baseUrl: body.agentConfig.baseUrl,
        model: body.agentConfig.model,
        apiType: body.agentConfig.apiType,
      };

      // Also persist provider/model metadata for debugging
      if (body.agentProvider) fileConfig.agentProvider = body.agentProvider;
      if (body.defaultProvider) fileConfig.defaultProvider = body.defaultProvider;
      if (body.defaultModel) fileConfig.defaultModel = body.defaultModel;

      const dir = join(configPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');
      console.log('[ProvidersAPI] agentConfig persisted to config.json');
    } catch (err) {
      console.error('[ProvidersAPI] Failed to persist agentConfig:', err);
    }
  }

  console.log('[ProvidersAPI] Settings synced:', {
    agentProvider: body.agentProvider,
    defaultProvider: body.defaultProvider,
    defaultModel: body.defaultModel,
    hasApiKey: !!body.agentConfig?.apiKey,
    hasBaseUrl: !!body.agentConfig?.baseUrl,
  });

  return c.json({
    success: true,
    config: manager.getConfig(),
  });
});

/**
 * GET /providers/config
 * Get current provider configuration
 */
providersRoutes.get('/config', (c) => {
  const manager = getProviderManager();
  return c.json(manager.getConfig());
});

// ----------------------------------------------------------------------------
// Detection Routes
// ----------------------------------------------------------------------------

interface DetectBody {
  baseUrl: string;
  apiKey: string;
  model?: string;
  apiType?: 'anthropic-messages' | 'openai-completions';
}

interface DetectSuccessResponse {
  success: true;
  message: string;
  model: string;
  response: unknown;
}

interface DetectErrorResponse {
  success: false;
  error: string;
}

// Union type for future use if needed
// type DetectResponse = DetectSuccessResponse | DetectErrorResponse;

/**
 * Build API URL from base URL based on API type.
 * Supports '#' suffix to disable automatic /v1 insertion.
 */
function buildApiUrl(baseUrl: string, apiType?: string): string {
  const isOpenAI = apiType === 'openai-completions';
  const suffix = isOpenAI ? '/chat/completions' : '/messages';
  return buildEndpointUrl(baseUrl, suffix);
}

/**
 * POST /providers/detect
 * Detect if an OpenAI-compatible API configuration is valid
 */
providersRoutes.post('/detect', async (c) => {
  const body = await c.req.json<DetectBody>();

  if (!body.baseUrl || !body.apiKey) {
    return c.json({ error: 'baseUrl and apiKey are required' }, 400);
  }

  const apiType = body.apiType || 'anthropic-messages';
  const apiUrl = buildApiUrl(body.baseUrl, apiType);
  const testModel = body.model || DEFAULT_TEST_MODEL;

  console.log('[ProvidersAPI] Detecting API connection:', {
    baseUrl: body.baseUrl,
    apiType,
    apiUrl,
    model: testModel,
  });

  const isOpenAI = apiType === 'openai-completions';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isOpenAI) {
    headers['Authorization'] = `Bearer ${body.apiKey}`;
  } else {
    headers['x-api-key'] = body.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }

  const requestBody = isOpenAI
    ? { model: testModel, messages: [{ role: 'user', content: DETECT_TEST_MESSAGE }], max_tokens: 1, stream: true }
    : { model: testModel, messages: [{ role: 'user', content: DETECT_TEST_MESSAGE }], max_tokens: 1, stream: true };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      // Drain the stream body to avoid resource leaks, but we don't need to parse it —
      // HTTP 200 from a streaming endpoint is sufficient proof of a valid connection.
      try { await response.text(); } catch { /* best-effort drain */ }

      const successResponse: DetectSuccessResponse = {
        success: true,
        message: 'Connection successful! Configuration valid',
        model: testModel,
        response: {},
      };
      return c.json(successResponse);
    }

    const errorText = await response.text().catch(() => '');
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorData = JSON.parse(errorText);
      errorMsg = errorData.error?.message || errorData.message || errorMsg;
    } catch { /* non-JSON error body, use HTTP status */ }

    console.error('[ProvidersAPI] Detection failed:', {
      status: response.status,
      error: errorMsg,
    });

    const errorResponse: DetectErrorResponse = {
      success: false,
      error: errorMsg,
    };
    return c.json(errorResponse, 200);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[ProvidersAPI] Detection error:', error);

    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutResponse: DetectErrorResponse = {
        success: false,
        error: 'Connection timeout (60s)',
      };
      return c.json(timeoutResponse, 200);
    }

    const errorResponse: DetectErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
    return c.json(errorResponse, 200);
  }
});

export { providersRoutes };
