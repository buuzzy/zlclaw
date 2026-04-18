/**
 * Feishu (飞书) Channel Management API
 *
 * Manages Feishu channel configuration and lifecycle:
 *  - GET  /status  → Current connection status and config state
 *  - POST /config  → Save App ID / App Secret, auto-connect
 *  - POST /test    → Test credentials without saving
 *  - POST /connect → Connect (or reconnect) the adapter
 *  - POST /disconnect → Disconnect the adapter
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Hono } from 'hono';

import { getConfigLoader } from '@/config/loader';
import { getConfigPath } from '@/shared/utils/paths';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// ─── Types ────────────────────────────────────────────────────────────────

type FeishuStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface FeishuState {
  status: FeishuStatus;
  errorMessage: string | null;
  connectedAt: number | null;
}

const state: FeishuState = {
  status: 'idle',
  errorMessage: null,
  connectedAt: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

interface FeishuConfigFile {
  env?: Record<string, string>;
  channels?: {
    feishu?: {
      enabled?: boolean;
      connectionMode?: string;
      appId?: string;
      appSecret?: string;
      verificationToken?: string;
      encryptKey?: string;
    };
  };
  [key: string]: unknown;
}

function readConfigFile(): FeishuConfigFile {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function writeConfigFile(config: FeishuConfigFile): void {
  const configPath = getConfigPath();
  const dir = join(configPath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

interface FeishuChannelConfig {
  enabled?: boolean;
  connectionMode?: string;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
}

function getFeishuConfig(): FeishuChannelConfig {
  const config = readConfigFile();
  return config.channels?.feishu || {};
}

/**
 * Test Feishu credentials by requesting a tenant_access_token.
 * Returns { ok, botName?, error? }
 */
async function testCredentials(appId: string, appSecret: string): Promise<{
  ok: boolean;
  botName?: string;
  error?: string;
}> {
  try {
    // Step 1: Get tenant_access_token
    const tokenRes = await fetch(
      `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      }
    );

    if (!tokenRes.ok) {
      return { ok: false, error: `HTTP ${tokenRes.status}` };
    }

    const tokenData = (await tokenRes.json()) as {
      code: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (tokenData.code !== 0) {
      return { ok: false, error: tokenData.msg || `Error code: ${tokenData.code}` };
    }

    const token = tokenData.tenant_access_token;
    if (!token) {
      return { ok: false, error: 'No token returned' };
    }

    // Step 2: Get bot info to verify the token works
    const botRes = await fetch(`${FEISHU_API_BASE}/bot/v3/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!botRes.ok) {
      // Token works but bot API failed — still valid credentials
      return { ok: true };
    }

    const botData = (await botRes.json()) as {
      code: number;
      bot?: { app_name?: string };
    };

    if (botData.code === 0 && botData.bot?.app_name) {
      return { ok: true, botName: botData.bot.app_name };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Register (or re-register) the Feishu adapter with ChannelManager.
 */
async function connectFeishuAdapter(feishuCfg: {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  connectionMode?: string;
}): Promise<void> {
  const { FeishuAdapter } = await import('@/extensions/channel/feishu');
  const { getChannelManager } = await import('@/core/channel');
  const manager = getChannelManager();

  // manager.register handles shutdown of any existing adapter with the same id
  await manager.register(new FeishuAdapter(), {
    enabled: true,
    connectionMode: (feishuCfg.connectionMode || 'websocket') as 'websocket' | 'webhook',
    appId: feishuCfg.appId,
    appSecret: feishuCfg.appSecret,
    verificationToken: feishuCfg.verificationToken || '',
    encryptKey: feishuCfg.encryptKey || '',
  });
}

/**
 * Disconnect the Feishu adapter.
 */
async function disconnectFeishuAdapter(): Promise<void> {
  const { getChannelManager } = await import('@/core/channel');
  const manager = getChannelManager();
  const adapter = manager.getAdapter('feishu');

  if (adapter) {
    try {
      if (adapter.disconnect) await adapter.disconnect();
      await adapter.shutdown();
    } catch {
      // ignore
    }
  }
}

// ─── Sync state from adapter ─────────────────────────────────────────────

function syncStateFromAdapter(): void {
  try {
    // Dynamic require to avoid circular deps at module load time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getChannelManager } = require('@/core/channel');
    const manager = getChannelManager();
    const adapter = manager.getAdapter('feishu');

    if (adapter && adapter.isConnected?.()) {
      state.status = 'connected';
      if (!state.connectedAt) state.connectedAt = Date.now();
    } else if (state.status === 'connected') {
      // Was connected but adapter says no
      state.status = 'idle';
      state.connectedAt = null;
    }
  } catch {
    // ChannelManager not initialized yet
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────

export const feishuRoutes = new Hono();

/**
 * GET /last-errors
 * Returns the last 10 send errors from the Feishu adapter for debugging.
 */
feishuRoutes.get('/last-errors', async (c) => {
  try {
    const { getChannelManager } = await import('@/core/channel');
    const manager = getChannelManager();
    const adapter = manager.getAdapter('feishu');
    if (!adapter) {
      return c.json({ errors: [], sendTrace: [], message: 'Feishu adapter not registered' });
    }
    const feishuAdapter = adapter as import('@/extensions/channel/feishu').FeishuAdapter;
    return c.json({
      errors: feishuAdapter.lastErrors ?? [],
      sendTrace: feishuAdapter.sendTrace ?? [],
    });
  } catch (err) {
    return c.json({ errors: [], sendTrace: [], error: (err as Error).message });
  }
});

/**
 * GET /status
 * Returns current Feishu channel status and configuration state.
 */
feishuRoutes.get('/status', (c) => {
  syncStateFromAdapter();

  const feishuCfg = getFeishuConfig();
  const hasConfig = !!(feishuCfg.appId && feishuCfg.appSecret);
  const enabled = feishuCfg.enabled ?? false;

  // Mask App Secret for display
  const maskedSecret = feishuCfg.appSecret
    ? feishuCfg.appSecret.slice(0, 4) + '****' + feishuCfg.appSecret.slice(-4)
    : '';

  return c.json({
    status: state.status,
    errorMessage: state.errorMessage,
    connectedAt: state.connectedAt,
    hasConfig,
    enabled,
    appId: feishuCfg.appId || '',
    appSecretMasked: maskedSecret,
    connectionMode: feishuCfg.connectionMode || 'websocket',
  });
});

/**
 * POST /config
 * Save Feishu credentials and optionally auto-connect.
 * Body: { appId, appSecret, autoConnect? }
 */
feishuRoutes.post('/config', async (c) => {
  const body = await c.req.json<{
    appId?: string;
    appSecret?: string;
    autoConnect?: boolean;
  }>();

  const { appId, appSecret, autoConnect = true } = body;

  if (!appId || !appSecret) {
    return c.json({ ok: false, error: 'missing_fields', message: 'App ID and App Secret are required' }, 400);
  }

  // Test credentials first
  const testResult = await testCredentials(appId, appSecret);
  if (!testResult.ok) {
    return c.json({
      ok: false,
      error: 'invalid_credentials',
      message: testResult.error || 'Credentials verification failed',
    }, 400);
  }

  // Save to config.json
  const config = readConfigFile();
  if (!config.channels) config.channels = {};
  config.channels.feishu = {
    ...config.channels.feishu,
    enabled: true,
    connectionMode: 'websocket',
    appId,
    appSecret,
  };
  writeConfigFile(config);

  // Update in-memory config
  const loader = getConfigLoader();
  loader.set('channels.feishu.enabled', true);
  loader.set('channels.feishu.appId', appId);
  loader.set('channels.feishu.appSecret', appSecret);
  loader.set('channels.feishu.connectionMode', 'websocket');

  console.log('[Feishu] Config saved', { appId, botName: testResult.botName });

  // Auto-connect if requested
  if (autoConnect) {
    state.status = 'connecting';
    state.errorMessage = null;

    try {
      await connectFeishuAdapter({
        appId,
        appSecret,
        verificationToken: config.channels.feishu.verificationToken,
        encryptKey: config.channels.feishu.encryptKey,
        connectionMode: 'websocket',
      });

      state.status = 'connected';
      state.connectedAt = Date.now();

      console.log('[Feishu] Auto-connected after config save');
    } catch (err) {
      state.status = 'error';
      state.errorMessage = (err as Error).message;
      console.error('[Feishu] Auto-connect failed:', err);

      return c.json({
        ok: true,
        configSaved: true,
        connected: false,
        botName: testResult.botName,
        error: state.errorMessage,
      });
    }
  }

  return c.json({
    ok: true,
    configSaved: true,
    connected: autoConnect && state.status === 'connected',
    botName: testResult.botName,
  });
});

/**
 * POST /test
 * Test credentials without saving.
 * Body: { appId, appSecret }
 */
feishuRoutes.post('/test', async (c) => {
  const body = await c.req.json<{ appId?: string; appSecret?: string }>();

  if (!body.appId || !body.appSecret) {
    return c.json({ ok: false, error: 'missing_fields', message: 'App ID and App Secret are required' }, 400);
  }

  const result = await testCredentials(body.appId, body.appSecret);

  return c.json({
    ok: result.ok,
    botName: result.botName,
    error: result.error,
  });
});

/**
 * POST /connect
 * Connect (or reconnect) the Feishu adapter using saved config.
 */
feishuRoutes.post('/connect', async (c) => {
  const feishuCfg = getFeishuConfig();

  if (!feishuCfg.appId || !feishuCfg.appSecret) {
    return c.json({ ok: false, error: 'not_configured', message: 'Feishu is not configured. Please save App ID and App Secret first.' }, 400);
  }

  state.status = 'connecting';
  state.errorMessage = null;

  try {
    await connectFeishuAdapter({
      appId: feishuCfg.appId,
      appSecret: feishuCfg.appSecret,
      verificationToken: feishuCfg.verificationToken,
      encryptKey: feishuCfg.encryptKey,
      connectionMode: feishuCfg.connectionMode,
    });

    state.status = 'connected';
    state.connectedAt = Date.now();

    // Ensure config.json has enabled=true
    const config = readConfigFile();
    if (config.channels?.feishu) {
      config.channels.feishu.enabled = true;
      writeConfigFile(config);
    }

    return c.json({ ok: true, status: 'connected' });
  } catch (err) {
    state.status = 'error';
    state.errorMessage = (err as Error).message;
    console.error('[Feishu] Connect failed:', err);
    return c.json({ ok: false, error: 'connect_failed', message: state.errorMessage }, 500);
  }
});

/**
 * POST /disconnect
 * Disconnect the Feishu adapter and disable in config.
 */
feishuRoutes.post('/disconnect', async (c) => {
  try {
    await disconnectFeishuAdapter();
  } catch {
    // ignore
  }

  state.status = 'idle';
  state.connectedAt = null;
  state.errorMessage = null;

  // Update config.json
  const config = readConfigFile();
  if (config.channels?.feishu) {
    config.channels.feishu.enabled = false;
    writeConfigFile(config);
  }

  // Update in-memory config
  const loader = getConfigLoader();
  loader.set('channels.feishu.enabled', false);

  console.log('[Feishu] Disconnected');
  return c.json({ ok: true, status: 'idle' });
});

// ─── Startup Helper ──────────────────────────────────────────────────────

/**
 * Called from index.ts at server startup to register the Feishu adapter
 * and sync state with this module's state tracker.
 */
export async function connectOnStartup(feishuConfig: Record<string, unknown>): Promise<void> {
  const appId = (feishuConfig.appId as string) || '';
  const appSecret = (feishuConfig.appSecret as string) || '';

  if (!appId || !appSecret) {
    console.log('[Feishu] Startup: missing credentials, skipping');
    return;
  }

  state.status = 'connecting';
  state.errorMessage = null;

  try {
    await connectFeishuAdapter({
      appId,
      appSecret,
      verificationToken: (feishuConfig.verificationToken as string) || '',
      encryptKey: (feishuConfig.encryptKey as string) || '',
      connectionMode: (feishuConfig.connectionMode as string) || 'websocket',
    });

    state.status = 'connected';
    state.connectedAt = Date.now();
  } catch (err) {
    state.status = 'error';
    state.errorMessage = (err as Error).message;
    throw err;
  }
}
