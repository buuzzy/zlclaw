/**
 * User-scoped paths
 *
 * 为"每个登录用户"提供独立的数据根目录：
 *   ~/.sage/users/{uid}/
 *     ├── sage.db          — 当前用户的 SQLite（tasks/messages/files/sessions/settings）
 *     └── sessions/
 *         └── {sessionId}/attachments/...
 *
 * 与 `src/shared/lib/paths.ts` 的关系：
 *   - paths.ts 管理**共享**目录（skills/defaults/mcp.json/logs/memory/cron/config.json），
 *     这些目录跟登录账号无关，不做隔离。
 *   - user-scoped-paths.ts 只管**用户私有**数据的路径推导，每次都要带 uid。
 *
 * 设计原则：
 *   - 纯函数 + 轻量 cache（homeDir / sep 缓存一次即可，不按 uid 缓存，避免切换账号时漏失效）。
 *   - Tauri-only。在浏览器模式下返回 `~/.sage/...` 占位字符串（目前浏览器模式不走 SQLite，
 *     不会真的用到这些路径）。
 *   - 确保目录存在的 helper 单独提供，不在 path 解析函数里隐式 mkdir，避免副作用。
 */

import { getPathSeparator } from './paths';

// ─── Env helpers ─────────────────────────────────────────────────────────────

function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

let cachedHome: string | null = null;

async function getHome(): Promise<string> {
  if (cachedHome) return cachedHome;

  if (isTauri()) {
    try {
      const { homeDir } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      // Normalize trailing separator
      cachedHome = home.replace(/[/\\]$/, '');
      return cachedHome;
    } catch (err) {
      console.warn('[user-scoped-paths] homeDir failed:', err);
    }
  }

  cachedHome = '~';
  return cachedHome;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Supabase user id 是 UUID。为了防路径注入，只接受合法 UUID 形态。
 * 非法时抛出 —— 调用方（bindUserId）必须处理。
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidUid(uid: string): void {
  if (!uid || !UUID_RE.test(uid)) {
    throw new Error(`[user-scoped-paths] invalid uid: ${uid}`);
  }
}

// ─── Path builders ───────────────────────────────────────────────────────────

/**
 * ~/.sage —— Sage 根目录（共享）。
 * 注意：这个也是 paths.ts 的 `getAppDataDir()` 返回的值，语义一样。
 * 这里复制一份是为了避免形成循环依赖（paths.ts 已经被大量地方 import）。
 */
export async function getSageRootDir(): Promise<string> {
  const home = await getHome();
  const sep = await getPathSeparator();
  return `${home}${sep}.sage`;
}

/**
 * ~/.sage/users/{uid}
 */
export async function getUserDataDir(uid: string): Promise<string> {
  assertValidUid(uid);
  const root = await getSageRootDir();
  const sep = await getPathSeparator();
  return `${root}${sep}users${sep}${uid}`;
}

/**
 * ~/.sage/users/{uid}/sessions
 */
export async function getUserSessionsDir(uid: string): Promise<string> {
  const userDir = await getUserDataDir(uid);
  const sep = await getPathSeparator();
  return `${userDir}${sep}sessions`;
}

/**
 * Absolute path to the user's SQLite file.
 * Example: /Users/foo/.sage/users/3a6b.../sage.db
 */
export async function getUserDbAbsolutePath(uid: string): Promise<string> {
  const userDir = await getUserDataDir(uid);
  const sep = await getPathSeparator();
  return `${userDir}${sep}sage.db`;
}

/**
 * Connection string for `@tauri-apps/plugin-sql` `Database.load()`.
 *
 * Trick: plugin-sql 的 `path_mapper` 用 `PathBuf::push(raw_path)`，当 raw_path
 * 是绝对路径时，`push` 会**替换**原 base（app_config_dir）。所以传入
 * "sqlite:/absolute/path.db" 实际可用 —— 我们绕开 app_config_dir 的限制，
 * 把 DB 放到 ~/.sage/users/{uid}/ 下。
 */
export async function getUserDbConnString(uid: string): Promise<string> {
  const abs = await getUserDbAbsolutePath(uid);
  return `sqlite:${abs}`;
}

/**
 * Path to the migration marker file used by user-scope-migration.ts
 * (placed at the sage root, not per-user — 迁移只做一次，全局标记避免多账号触发多次).
 */
export async function getGlobalMigrationMarkerPath(): Promise<string> {
  const root = await getSageRootDir();
  const sep = await getPathSeparator();
  return `${root}${sep}.user-scope-migration-v1`;
}

// ─── Filesystem helpers ──────────────────────────────────────────────────────

/**
 * 确保 ~/.sage/users/{uid}/sessions 目录存在。
 * Tauri-only；浏览器模式 no-op。
 */
export async function ensureUserDirs(uid: string): Promise<void> {
  if (!isTauri()) return;
  assertValidUid(uid);

  try {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    const sessionsDir = await getUserSessionsDir(uid);
    await mkdir(sessionsDir, { recursive: true });
  } catch (err) {
    // mkdir recursive 理论上对已存在目录也不报错，但保险起见 swallow
    console.warn('[user-scoped-paths] ensureUserDirs failed:', err);
  }
}
