/**
 * Local-Only Middleware
 *
 * Restricts access to routes that should only be reachable from the local
 * machine (Tauri desktop UI). Rejects any request whose source IP is not
 * a loopback address (127.x.x.x or ::1).
 *
 * Applied to execution-capable routes:
 *   /agent, /sandbox, /preview, /files, /mcp, /skills
 *
 * NOT applied to channel/ingress routes (/v1, /channels/*) which
 * intentionally accept external network connections (WeChat, Feishu).
 * Those routes enforce their own HTCLAW_CHANNEL_API_KEY auth.
 *
 * Rationale: The agent can execute shell commands, read/write local files,
 * and invoke arbitrary tools. Exposing these to remote callers without
 * authentication would be a critical security risk.
 */

import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

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
 * Middleware that only allows requests from loopback addresses.
 * Returns 403 Forbidden for any non-local source.
 *
 * Note: In production the Tauri sidecar binds exclusively to 127.0.0.1 so all
 * external connections are rejected at the TCP level before reaching this
 * middleware. This check provides defence-in-depth for development mode where
 * the server may bind 0.0.0.0.
 */
export async function localOnlyMiddleware(c: Context, next: Next): Promise<Response | void> {
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
