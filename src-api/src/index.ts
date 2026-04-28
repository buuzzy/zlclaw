import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

import {
  agentRoutes,
  channelRoutes,
  completionsRoutes,
  cronRoutes,
  feishuRoutes,
  filesRoutes,
  healthRoutes,
  mcpRoutes,
  memoryRoutes,
  previewRoutes,
  providersRoutes,
  sandboxRoutes,
  skillsRoutes,
  wechatRoutes,
} from '@/app/api';
import { corsMiddleware, localOnlyMiddleware } from '@/app/middleware/index.js';
import { loadConfig } from '@/config/loader.js';
import { DEFAULT_IWENCAI_API_KEY } from '@/config/constants';
import {
  initProviderManager,
  shutdownProviderManager,
} from '@/shared/provider/manager';
import { getPreviewManager } from '@/shared/services/preview';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', corsMiddleware);

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

// ── Execution-capable routes (local-only: Tauri desktop UI only) ────────────
// These routes can execute shell commands, read/write files, invoke tools, etc.
// They must never be exposed to remote callers.
app.use('/agent/*', localOnlyMiddleware);
app.use('/sandbox/*', localOnlyMiddleware);
app.use('/preview/*', localOnlyMiddleware);
app.use('/files/*', localOnlyMiddleware);
app.use('/mcp/*', localOnlyMiddleware);
app.use('/skills/*', localOnlyMiddleware);

// ── Management routes (local-only: config, memory, cron — no external access) ─
// These routes expose sensitive configuration and internal state.
// In production the sidecar binds 127.0.0.1 so external access is already
// blocked at TCP level; this is defence-in-depth for dev mode (0.0.0.0).
app.use('/providers/*', localOnlyMiddleware);
app.use('/memory/*', localOnlyMiddleware);
app.use('/cron/*', localOnlyMiddleware);

// Routes
app.route('/health', healthRoutes);
app.route('/agent', agentRoutes);
app.route('/sandbox', sandboxRoutes);
app.route('/preview', previewRoutes);
app.route('/providers', providersRoutes);
app.route('/files', filesRoutes);
app.route('/mcp', mcpRoutes);
app.route('/channels', channelRoutes);
app.route('/channels/wechat', wechatRoutes);
app.route('/channels/feishu', feishuRoutes);
app.route('/memory', memoryRoutes);
app.route('/skills', skillsRoutes);
app.route('/cron', cronRoutes);
app.route('/v1', completionsRoutes);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Sage API',
    version: '0.1.1',
    endpoints: {
      health: '/health',
      agent: '/agent',
      sandbox: '/sandbox',
      preview: '/preview',
      providers: '/providers',
      files: '/files',
      mcp: '/mcp',
      channels: '/channels',
      memory: '/memory',
      skills: '/skills',
      cron: '/cron',
      completions: '/v1/chat/completions',
      models: '/v1/models',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Default port: 2026 for development, 2620 for production (set via Tauri sidecar env)
const port = Number(process.env.PORT) || 2026;

// Store server instance for hot reload cleanup
let server: ServerType | null = null;

// Cleanup function
const cleanup = async () => {
  // Shutdown cron scheduler (stops all scheduled tasks)
  try {
    const { shutdownScheduler } = await import('@/shared/cron/scheduler');
    shutdownScheduler();
  } catch (error) {
    console.error('Error shutting down cron scheduler:', error);
  }

  // Disconnect all channel adapters (closes Feishu WebSocket, etc.)
  try {
    const { getChannelManager } = await import('@/core/channel/manager');
    await getChannelManager().shutdown();
  } catch (error) {
    console.error('Error shutting down channel manager:', error);
  }

  // Stop all preview servers
  try {
    const previewManager = getPreviewManager();
    await previewManager.stopAll();
  } catch (error) {
    console.error('Error stopping preview servers:', error);
  }

  // Shutdown provider manager
  try {
    await shutdownProviderManager();
  } catch (error) {
    console.error('Error shutting down provider manager:', error);
  }

  if (server) {
    server.close();
    server = null;
  }
};

// Handle hot reload - close existing server
process.on('SIGTERM', () => cleanup());
process.on('SIGINT', () => cleanup());

// For tsx watch - handle the restart signal
if (process.env.NODE_ENV !== 'production') {
  process.on('exit', () => cleanup());
}

// Initialize and start server
async function start() {
  console.log(`🚀 Sage API starting...`);

  // Ensure ~/.sage/ directory structure and default files are in place
  // Must run before loadConfig() which may read ~/.sage/config.json
  const { ensureAppDirInitialized } = await import('@/shared/init/first-run');
  await ensureAppDirInitialized();

  // Load configuration
  await loadConfig();

  // Inject default financial data API key (public key for all users)
  if (!process.env.IWENCAI_API_KEY) {
    process.env.IWENCAI_API_KEY = DEFAULT_IWENCAI_API_KEY;
  }

  // Install built-in skills to ~/.sage/skills/
  const { installBuiltinSkills } = await import('@/shared/skills/loader');
  await installBuiltinSkills();

  // Register filesystem skills with SDK so the Skill tool can find them
  const { registerFilesystemSkills } = await import('@/shared/skills/register');
  await registerFilesystemSkills();

  // Pre-populate the intent-predictor cache (async skills load)
  // so the first query doesn't pay the filesystem I/O cost.
  const { loadAndCacheSkills } = await import('@/shared/skills/predictor');
  await loadAndCacheSkills();

  // Inject channel API key from config
  const { getConfigLoader } = await import('@/config/loader');
  const channelApiKey = getConfigLoader().get<string>('channelApiKey');
  if (channelApiKey && !process.env.HTCLAW_CHANNEL_API_KEY) {
    process.env.HTCLAW_CHANNEL_API_KEY = channelApiKey;
  }

  // Register Feishu channel adapter if configured
  // Uses the feishu API module's state management for consistent status tracking
  const feishuConfig = getConfigLoader().get<Record<string, unknown>>('channels.feishu');
  if (feishuConfig && feishuConfig.enabled && feishuConfig.appId && feishuConfig.appSecret) {
    // Load persisted agentConfig from config.json BEFORE connecting Feishu
    // This ensures ChannelManager.resolveModelConfig() has data on startup
    // without waiting for the frontend to call POST /providers/settings/sync
    const savedAgentConfig = getConfigLoader().get<Record<string, unknown>>('agentConfig');
    if (savedAgentConfig && savedAgentConfig.apiKey) {
      const { getProviderManager } = await import('@/shared/provider/manager');
      const pm = getProviderManager();
      pm.updateFromSettings({
        agentProvider: (getConfigLoader().get<string>('agentProvider') || 'codeany'),
        agentConfig: savedAgentConfig,
      });
      console.log('🔑 Agent config loaded from config.json for channel adapters');
    } else {
      console.warn('⚠️  No persisted agentConfig in config.json — channel messages will fail until frontend syncs settings');
    }

    try {
      const { connectOnStartup } = await import('@/app/api/feishu');
      await connectOnStartup(feishuConfig);
      console.log(`🔗 Feishu channel adapter registered`);
    } catch (err) {
      console.error('❌ Feishu channel adapter failed to start:', err);
    }
  }

  // Auto-start WeClaw if previously connected
  const wechatConfig = getConfigLoader().get<Record<string, unknown>>('channels.wechat');
  if (wechatConfig && wechatConfig.enabled) {
    try {
      const { connectWechatOnStartup } = await import('@/app/api/wechat');
      await connectWechatOnStartup();
    } catch (err) {
      console.error('❌ WeClaw auto-start failed:', err);
    }
  }

  // Initialize provider manager
  await initProviderManager();

  // Trigger memory vector indexing (async, non-blocking)
  import('@/shared/memory/indexer').then(({ indexIfNeeded }) => {
    indexIfNeeded().catch((err) =>
      console.warn('[MemoryIndex] Startup index failed:', err)
    );
  });

  // Clean up old session files (async, non-blocking)
  import('@/shared/context/session-store').then(({ cleanupOldSessions }) => {
    cleanupOldSessions(7);
  });

  // Initialize cron scheduler (loads persisted jobs, schedules enabled ones)
  // The scheduler registers the built-in F25 memory consolidation job (23:00 daily)
  // and any user-created jobs from ~/.sage/cron/jobs.json
  const { initScheduler } = await import('@/shared/cron/scheduler');
  initScheduler();
  console.log('⏰ Cron scheduler initialized');

  console.log(`🚀 Server starting on http://localhost:${port}`);

  server = serve({
    fetch: app.fetch,
    port,
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Note: Don't export default app here, as Bun will try to auto-start it with Bun.serve()
// which conflicts with our @hono/node-server serve() call
