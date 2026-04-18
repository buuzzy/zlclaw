/**
 * WeChat (WeClaw) Management API
 *
 * Manages the WeClaw binary lifecycle:
 *  - POST /start   → Auto-install if missing, bind to HT Claw, launch WeClaw
 *  - GET  /status  → Real-time status (process + config binding detection)
 *  - POST /stop    → Kill WeClaw process
 *  - POST /bind    → Switch WeClaw's default_agent to htclaw
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { Hono } from 'hono';

const HOME = process.env.HOME || '';
const WECLAW_DIR = join(HOME, '.weclaw');
const WECLAW_BIN = join(WECLAW_DIR, 'bin', 'weclaw');
const WECLAW_CONFIG = join(WECLAW_DIR, 'config.json');
const GITHUB_API = 'https://api.github.com/repos/fastclaw-ai/weclaw/releases/latest';
const HTCLAW_AGENT_NAME = 'htclaw';

type WeChatStatus = 'idle' | 'starting' | 'installing' | 'waiting_scan' | 'connected' | 'bound_other' | 'error';

interface WeChatState {
  status: WeChatStatus;
  qrUrl: string | null;
  qrExpireAt: number | null;
  errorMessage: string | null;
  process: ChildProcess | null;
  pid: number | null;
}

const state: WeChatState = {
  status: 'idle',
  qrUrl: null,
  qrExpireAt: null,
  errorMessage: null,
  process: null,
  pid: null,
};

interface WeClawConfig {
  default_agent?: string;
  agents?: Record<string, { type?: string; endpoint?: string; model?: string; [k: string]: unknown }>;
}

const WECLAW_API = 'http://127.0.0.1:18011';

interface ProbeResult {
  processAlive: boolean;
  healthOk: boolean;
  boundAgent: string | null;
  boundToHtclaw: boolean;
}

function readWeClawConfig(): WeClawConfig | null {
  try {
    if (!existsSync(WECLAW_CONFIG)) return null;
    return JSON.parse(readFileSync(WECLAW_CONFIG, 'utf-8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the real WeClaw state using three independent sources:
 * 1. Process liveness: kill(pid, 0) for our managed process
 * 2. Health endpoint: GET http://127.0.0.1:18011/health (works for both foreground & daemon)
 * 3. Config file: ~/.weclaw/config.json for binding info
 */
function probeRealStatus(): ProbeResult {
  const config = readWeClawConfig();
  const boundAgent = config?.default_agent ?? null;
  const port = Number(process.env.PORT) || 2026;
  const htclawEndpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  const agentConfig = boundAgent && config?.agents?.[boundAgent];
  const boundToHtclaw = boundAgent === HTCLAW_AGENT_NAME
    || (!!agentConfig && typeof agentConfig === 'object' && (agentConfig as any).endpoint === htclawEndpoint);

  const processAlive = isProcessAlive(state.pid);

  // Synchronous health check via curl (WeClaw API on 18011)
  let healthOk = false;
  try {
    const out = execSync(
      `curl -sf --max-time 1 ${WECLAW_API}/health 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 },
    );
    healthOk = out.trim() === 'ok';
  } catch {}

  return { processAlive, healthOk, boundAgent, boundToHtclaw };
}

function bindToHtclaw(): void {
  const config = readWeClawConfig() || { agents: {} };
  config.default_agent = HTCLAW_AGENT_NAME;
  if (!config.agents) config.agents = {};
  const port = Number(process.env.PORT) || 2026;
  config.agents[HTCLAW_AGENT_NAME] = {
    type: 'http',
    endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    model: HTCLAW_AGENT_NAME,
    system_prompt: '你是 HT Claw 金融 AI 助手，擅长股票行情分析、K线图解读和金融数据查询。',
    ...(config.agents[HTCLAW_AGENT_NAME] || {}),
  };
  config.agents[HTCLAW_AGENT_NAME].endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  writeFileSync(WECLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8');
  console.log('[WeClaw] Config bound to htclaw');
}

function findWeClaw(): string | null {
  const candidates = [
    WECLAW_BIN,
    join(HOME, '.local', 'bin', 'weclaw'),
    '/usr/local/bin/weclaw',
    '/opt/homebrew/bin/weclaw',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function getAssetName(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const ext = process.platform === 'win32' ? '.exe' : '';
  return `weclaw_${platform}_${arch}${ext}`;
}

async function autoInstall(): Promise<string> {
  console.log('[WeClaw] Auto-installing from GitHub Releases...');

  const releaseRes = await fetch(GITHUB_API, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!releaseRes.ok) {
    throw new Error(`GitHub API error: ${releaseRes.status}`);
  }

  const release = (await releaseRes.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };

  const assetName = getAssetName();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(
      `No binary for ${assetName}. Available: ${release.assets.map((a) => a.name).join(', ')}`
    );
  }

  console.log(`[WeClaw] Downloading ${asset.name} (${release.tag_name})...`);

  const downloadRes = await fetch(asset.browser_download_url, { redirect: 'follow' });
  if (!downloadRes.ok || !downloadRes.body) {
    throw new Error(`Download failed: ${downloadRes.status}`);
  }

  mkdirSync(join(WECLAW_DIR, 'bin'), { recursive: true });

  const fileStream = createWriteStream(WECLAW_BIN);
  await pipeline(Readable.fromWeb(downloadRes.body as any), fileStream);
  chmodSync(WECLAW_BIN, 0o755);

  const version = execSync(`"${WECLAW_BIN}" version 2>&1`, { encoding: 'utf-8' }).trim();
  console.log(`[WeClaw] Installed: ${version}`);

  return WECLAW_BIN;
}

function ensureConfig(): void {
  mkdirSync(WECLAW_DIR, { recursive: true });
  if (!existsSync(WECLAW_CONFIG)) {
    bindToHtclaw();
    console.log('[WeClaw] Default config created at', WECLAW_CONFIG);
  }
}

function killProcess() {
  if (state.process && !state.process.killed) {
    state.process.kill('SIGTERM');
    setTimeout(() => {
      if (state.process && !state.process.killed) {
        state.process.kill('SIGKILL');
      }
    }, 3000);
  }
  state.process = null;
  state.pid = null;
}

function resetState() {
  killProcess();
  state.status = 'idle';
  state.qrUrl = null;
  state.qrExpireAt = null;
  state.errorMessage = null;
}

function launchWeClaw(binary: string): void {
  state.status = 'starting';

  // Stop any existing background process first
  try { execSync(`"${binary}" stop`, { timeout: 3000, stdio: 'ignore' }); } catch {}

  // Use --foreground so stdout/stderr come through our pipes (not a log file)
  const child = spawn(binary, ['start', '--foreground'], {
    cwd: WECLAW_DIR,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.process = child;
  state.pid = child.pid ?? null;

  let accumulated = '';

  const parseOutput = (text: string) => {
    accumulated += text;
    console.log('[WeClaw stdout]', text.trim());

    if (state.status === 'connected') return;

    // Pattern: "QR URL: https://..."
    const qrMatch = accumulated.match(/QR\s*URL:\s*(https?:\/\/[^\s]+)/i);
    if (qrMatch) {
      state.status = 'waiting_scan';
      state.qrUrl = qrMatch[1];
      state.qrExpireAt = Date.now() + 120_000;
    }

    // Login success patterns
    if (/login\s*(success|ok)|logged\s*in|successfully/i.test(text)) {
      state.status = 'connected';
      state.qrUrl = null;
    }

    // "Waiting for scan..." confirms QR is ready
    if (/waiting\s*for\s*scan/i.test(text) && state.qrUrl) {
      state.status = 'waiting_scan';
    }

    // Already logged in: monitor starts directly without QR
    if (/starting long-poll|Starting monitor|message bridge for \d+ account/i.test(text)) {
      state.status = 'connected';
      state.qrUrl = null;
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => parseOutput(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    console.error('[WeClaw stderr]', text.trim());
    parseOutput(text);
  });

  child.on('exit', (code) => {
    console.log('[WeClaw] Process exited with code:', code);
    // Always reset — a dead process cannot be "connected"
    if (code === 0) {
      state.status = 'idle';
      state.errorMessage = null;
    } else {
      state.status = 'error';
      state.errorMessage = `WeClaw exited with code ${code}`;
    }
    state.process = null;
    state.pid = null;
  });

  child.on('error', (err) => {
    console.error('[WeClaw] Process error:', err);
    state.status = 'error';
    state.errorMessage = err.message;
    state.process = null;
    state.pid = null;
  });
}

/**
 * Compute effective status using three layers of truth:
 *
 * 1. Transient in-memory states (starting/waiting_scan/installing) are trusted
 *    because only we manage these transitions.
 * 2. Process liveness: kill(pid, 0) verifies our managed process is truly alive.
 * 3. Health check: GET :18011/health verifies WeClaw is serving (foreground or daemon).
 * 4. Config binding: config.default_agent tells us who WeClaw forwards to.
 *
 * "connected" requires BOTH health=ok AND boundToHtclaw=true.
 */
function computeEffectiveStatus(): {
  status: WeChatStatus;
  boundAgent: string | null;
  boundToHtclaw: boolean;
  running: boolean;
} {
  const probe = probeRealStatus();
  const running = probe.processAlive || probe.healthOk;

  // Transient states from our managed flow (QR scan, install)
  const transient: WeChatStatus[] = ['starting', 'waiting_scan', 'installing'];
  if (transient.includes(state.status) && probe.processAlive) {
    return { status: state.status, boundAgent: probe.boundAgent, boundToHtclaw: probe.boundToHtclaw, running };
  }

  // If managed process died but state still thinks it's alive, fix it
  if (state.pid && !probe.processAlive) {
    state.process = null;
    state.pid = null;
    if (transient.includes(state.status) || state.status === 'connected') {
      state.status = 'idle';
    }
  }

  // WeClaw is alive (our process or external daemon)
  if (running) {
    return {
      status: probe.boundToHtclaw ? 'connected' : 'bound_other',
      boundAgent: probe.boundAgent,
      boundToHtclaw: probe.boundToHtclaw,
      running,
    };
  }

  // Nothing running
  return { status: 'idle', boundAgent: probe.boundAgent, boundToHtclaw: probe.boundToHtclaw, running: false };
}

export const wechatRoutes = new Hono();

wechatRoutes.post('/start', async (c) => {
  const effective = computeEffectiveStatus();

  // Already connected to HT Claw
  if (effective.status === 'connected') {
    return c.json({ ok: true, status: 'connected', qrUrl: state.qrUrl, qrExpireAt: state.qrExpireAt });
  }

  // QR scan in progress
  if (state.status === 'waiting_scan' && state.process && !state.process.killed) {
    return c.json({ ok: true, status: state.status, qrUrl: state.qrUrl, qrExpireAt: state.qrExpireAt });
  }

  // Still starting up
  if (state.process && !state.process.killed && state.status === 'starting') {
    return c.json({ ok: true, status: state.status });
  }

  resetState();

  let binary = findWeClaw();

  if (!binary) {
    state.status = 'installing';
    try {
      binary = await autoInstall();
    } catch (err) {
      state.status = 'error';
      state.errorMessage = `Auto-install failed: ${(err as Error).message}`;
      console.error('[WeClaw]', state.errorMessage);
      return c.json(
        { ok: false, error: 'install_failed', message: state.errorMessage, installUrl: 'https://github.com/fastclaw-ai/weclaw' },
        500,
      );
    }
  }

  ensureConfig();
  // Always ensure binding before launch
  bindToHtclaw();

  try {
    launchWeClaw(binary);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Persist enabled state for auto-start on restart
    persistWechatEnabled(true);

    return c.json({
      ok: true,
      status: state.status,
      qrUrl: state.qrUrl,
      qrExpireAt: state.qrExpireAt,
      pid: state.pid,
    });
  } catch (error) {
    state.status = 'error';
    state.errorMessage = (error as Error).message;
    return c.json({ ok: false, error: 'start_failed', message: state.errorMessage }, 500);
  }
});

wechatRoutes.get('/status', (c) => {
  if (state.qrExpireAt && Date.now() > state.qrExpireAt && state.status === 'waiting_scan') {
    state.qrUrl = null;
    state.qrExpireAt = null;
  }

  const effective = computeEffectiveStatus();

  return c.json({
    status: effective.status,
    qrUrl: state.qrUrl,
    qrExpireAt: state.qrExpireAt,
    errorMessage: state.errorMessage,
    installed: !!findWeClaw(),
    hasConfig: existsSync(WECLAW_CONFIG),
    pid: state.pid,
    boundAgent: effective.boundAgent,
    boundToHtclaw: effective.boundToHtclaw,
    running: effective.running,
  });
});

wechatRoutes.post('/bind', async (c) => {
  const binary = findWeClaw();
  if (!binary) {
    return c.json({ ok: false, error: 'not_installed', message: 'WeClaw not installed' }, 400);
  }

  ensureConfig();
  bindToHtclaw();

  // If WeClaw is running (foreground or daemon), restart to pick up new config
  const probe = probeRealStatus();
  if (probe.healthOk || probe.processAlive) {
    // Kill our managed foreground process if any
    killProcess();
    // Restart via CLI (handles daemon restart)
    try {
      execSync(`"${binary}" stop 2>&1`, { timeout: 3000, stdio: 'ignore' });
    } catch {}
    try {
      execSync(`"${binary}" restart 2>&1`, { timeout: 5000, encoding: 'utf-8' });
      console.log('[WeClaw] Restarted with htclaw binding');
    } catch {}
  }

  return c.json({ ok: true, boundAgent: HTCLAW_AGENT_NAME });
});

wechatRoutes.post('/stop', (c) => {
  resetState();
  const binary = findWeClaw();
  if (binary) {
    try { execSync(`"${binary}" stop`, { timeout: 3000, stdio: 'ignore' }); } catch {}
  }
  // Clear session cache so next connect requires QR scan
  const accountsDir = join(WECLAW_DIR, 'accounts');
  if (existsSync(accountsDir)) {
    rmSync(accountsDir, { recursive: true, force: true });
    console.log('[WeClaw] Cleared session cache');
  }

  // Persist disabled state so auto-start won't reconnect
  persistWechatEnabled(false);

  return c.json({ ok: true, status: 'idle' });
});

// ─── Persistence helpers ─────────────────────────────────────────────

import { getConfigPath } from '@/shared/utils/paths';

function persistWechatEnabled(enabled: boolean): void {
  try {
    const configPath = getConfigPath();
    let config: Record<string, unknown> = {};
    try {
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch {}
    if (!config.channels) config.channels = {};
    (config.channels as Record<string, unknown>).wechat = { enabled };
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[WeClaw] Persisted wechat.enabled=${enabled}`);
  } catch (err) {
    console.error('[WeClaw] Failed to persist enabled state:', err);
  }
}

/**
 * Called from index.ts at server startup.
 * Auto-starts WeClaw if it was previously connected and not explicitly stopped.
 */
export async function connectWechatOnStartup(): Promise<void> {
  // Check if WeClaw binary exists
  const binary = findWeClaw();
  if (!binary) {
    console.log('[WeClaw] Startup: binary not found, skipping');
    return;
  }

  // Check if WeClaw config exists and is bound to htclaw
  const config = readWeClawConfig();
  if (!config || config.default_agent !== HTCLAW_AGENT_NAME) {
    console.log('[WeClaw] Startup: not bound to htclaw, skipping');
    return;
  }

  // Check if WeClaw is already running (e.g. daemon mode)
  try {
    const out = execSync(
      `curl -sf --max-time 1 ${WECLAW_API}/health 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 },
    );
    if (out.trim() === 'ok') {
      state.status = 'connected';
      console.log('[WeClaw] Startup: already running, status=connected');
      return;
    }
  } catch {}

  // Ensure binding is up to date (port may have changed)
  bindToHtclaw();

  // Launch WeClaw
  console.log('[WeClaw] Startup: auto-starting...');
  try {
    launchWeClaw(binary);
    // Wait a bit for it to initialize
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`[WeClaw] Startup: launched, status=${state.status}, pid=${state.pid}`);
  } catch (err) {
    console.error('[WeClaw] Startup: auto-start failed:', err);
    state.status = 'error';
    state.errorMessage = (err as Error).message;
  }
}
