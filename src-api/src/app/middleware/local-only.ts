/**
 * Local-Only / Token Auth Middleware
 *
 * Two modes based on environment:
 *
 * 1. **Cloud mode** (SAGE_API_TOKEN is set):
 *    Validates `Authorization: Bearer <token>` header.
 *    Used when sage-api is deployed to Railway / cloud.
 *
 * 2. **Local mode** (SAGE_API_TOKEN is NOT set):
 *    Restricts access to loopback addresses (127.x.x.x / ::1).
 *    Used when sage-api runs as Tauri desktop sidecar.
 *
 * Applied to execution-capable routes:
 *   /agent, /sandbox, /preview, /files, /mcp, /skills
 *
 * NOT applied to channel/ingress routes (/v1, /channels/*) which
 * intentionally accept external network connections (WeChat, Feishu).
 * Those routes enforce their own HTCLAW_CHANNEL_API_KEY auth.
 */

import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

const API_TOKEN = process.env.SAGE_API_TOKEN;

/**
 * Returns true if the address is a loopback (local) address.
 */
function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  // Strip IPv6-mapped IPv4 prefix and brackets
  const clean = addr.replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '').trim();
  return (
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === 'localhost' ||
    clean.startsWith('127.')
  );
}

/**
 * Middleware that guards sensitive routes.
 *
 * Cloud mode:  checks Authorization: Bearer <SAGE_API_TOKEN>
 * Local mode:  checks source IP is loopback
 */
export async function localOnlyMiddleware(c: Context, next: Next): Promise<Response | void> {
  // ── Cloud mode: token-based auth ──────────────────────────────────────────
  if (API_TOKEN) {
    const authHeader = c.req.header('authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    if (token !== API_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
    return;
  }

  // ── Local mode: loopback check (desktop sidecar) ──────────────────────────
  let remoteAddr: string | undefined;

  try {
    const info = getConnInfo(c);
    remoteAddr = info.remote.address;
  } catch {
    // getConnInfo may throw in non-node environments; fall back to header heuristics
  }

  // Fallback: X-Forwarded-For is present only when behind a reverse proxy; in
  // direct node server mode it should be absent for local requests.
  if (!remoteAddr) {
    remoteAddr = c.req.header('x-real-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  }

  if (!isLoopback(remoteAddr)) {
    console.warn(
      `[Security] Blocked non-local request to ${c.req.path} from ${remoteAddr ?? 'unknown'}`
    );
    return c.json(
      { error: 'Forbidden: this endpoint is only accessible from localhost' },
      403
    );
  }

  await next();
}
