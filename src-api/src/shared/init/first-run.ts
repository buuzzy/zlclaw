/**
 * First-Run Initialization
 *
 * Ensures ~/.sage/ is fully set up before the server starts.
 * This runs on every startup but is idempotent — it only creates
 * files and directories that don't already exist, never overwriting
 * user data.
 *
 * Execution order in index.ts:
 *   ensureAppDirInitialized()  ← this file
 *   loadConfig()
 *   installBuiltinSkills()     ← handles skill copying
 *   ...
 */

import { existsSync, mkdirSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAppDir } from '@/config/constants';
import { migrateFromHTclaw } from './migration';

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Resolve the bundled defaults source directory.
 * Uses the same three-tier strategy as getBuiltinSkillsSourceDir() in loader.ts:
 *   Dev (tsx):   src-api/src/shared/init/ → src-api/resources/defaults/
 *   TSC build:   dist/shared/init/        → resources/defaults/  (two levels up)
 *   Pkg binary:  process.cwd()/resources/defaults/
 */
function getDefaultsSourceDir(): string {
  let thisDir: string;
  try {
    thisDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    thisDir = (typeof __dirname !== 'undefined' ? __dirname : null) || process.cwd();
  }

  // Dev (tsx):  src-api/src/shared/init/ → 3 ups = src-api/resources/defaults
  // TSC build:  src-api/dist/shared/init/ → 3 ups = src-api/resources/defaults (same)
  const srcPath = join(thisDir, '..', '..', '..', 'resources', 'defaults');
  if (existsSync(srcPath)) return srcPath;

  // Pkg binary in macOS .app bundle:
  //   process.execPath = Contents/MacOS/sage-api-aarch64-apple-darwin
  //   Tauri resources  = Contents/Resources/resources/defaults/
  const binaryDir = dirname(process.execPath);
  const appBundlePath = join(binaryDir, '..', 'Resources', 'resources', 'defaults');
  if (existsSync(appBundlePath)) return appBundlePath;

  // Fallback: CWD-relative (for non-Tauri or dev overrides)
  const pkgPath = join(process.cwd(), 'resources', 'defaults');
  if (existsSync(pkgPath)) return pkgPath;

  return srcPath; // fallback (will log warning if not found)
}

// ============================================================================
// Directory Setup
// ============================================================================

const REQUIRED_DIRS = [
  '',          // ~/.sage/ itself
  'skills',
  'sessions',
  'memory',
  'logs',
  'cache',
  'cron',
];

function ensureDirectories(appDir: string): void {
  for (const sub of REQUIRED_DIRS) {
    const dir = sub ? join(appDir, sub) : appDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`[Init] Created directory: ${dir}`);
    }
  }
}

// ============================================================================
// Default File Setup
// ============================================================================

/**
 * Copy a file from source to dest only if dest doesn't exist.
 */
async function copyIfMissing(src: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  try {
    await fs.copyFile(src, dest);
    console.log(`[Init] Installed default: ${dest}`);
  } catch (err) {
    console.warn(`[Init] Failed to copy ${src} → ${dest}:`, err);
  }
}

/**
 * Always overwrite dest with src (for system-managed files like SOUL.md, AGENTS.md).
 * These are not user-editable — they ship with each app version.
 */
async function copyAlways(src: string, dest: string): Promise<void> {
  try {
    await fs.copyFile(src, dest);
    console.log(`[Init] Updated system file: ${dest}`);
  } catch (err) {
    console.warn(`[Init] Failed to copy ${src} → ${dest}:`, err);
  }
}

/**
 * Write content to a file only if it doesn't exist.
 */
async function writeIfMissing(dest: string, content: string): Promise<void> {
  if (existsSync(dest)) return;
  try {
    await fs.writeFile(dest, content, 'utf8');
    console.log(`[Init] Created default file: ${dest}`);
  } catch (err) {
    console.warn(`[Init] Failed to create ${dest}:`, err);
  }
}

async function installDefaultFiles(appDir: string): Promise<void> {
  const defaultsDir = getDefaultsSourceDir();

  // Copy bundled config files (only if bundled source exists)
  if (existsSync(defaultsDir)) {
    await copyAlways(join(defaultsDir, 'AGENTS.md'), join(appDir, 'AGENTS.md'));
    await copyAlways(join(defaultsDir, 'SOUL.md'), join(appDir, 'SOUL.md'));
    await copyIfMissing(join(defaultsDir, 'skills-config.json'), join(appDir, 'skills-config.json'));
  } else {
    console.warn(`[Init] Defaults source directory not found: ${defaultsDir}`);
  }

  // Create skeleton files with minimal content
  await writeIfMissing(
    join(appDir, 'mcp.json'),
    JSON.stringify({ mcpServers: {} }, null, 2) + '\n',
  );
  await writeIfMissing(
    join(appDir, 'user.md'),
    '# User Profile\n',
  );
  await writeIfMissing(
    join(appDir, 'MEMORY.md'),
    '# Long-term Memory\n',
  );
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Idempotent first-run initialization.
 * Call this at the very start of start() in index.ts, before loadConfig().
 *
 * Execution order:
 *   1. Ensure all required directories exist
 *   2. Migrate user data from ~/.htclaw/ (if upgrading from HTclaw)
 *   3. Install bundled default files and create skeleton files
 */
export async function ensureAppDirInitialized(): Promise<void> {
  const appDir = getAppDir();

  try {
    // 1. Ensure all required directories exist
    ensureDirectories(appDir);

    // 2. Migrate user data from ~/.htclaw/ (if upgrading from HTclaw)
    await migrateFromHTclaw();

    // 3. Install bundled default files (AGENTS.md, SOUL.md, skills-config.json)
    //    and create skeleton files (mcp.json, user.md, MEMORY.md)
    await installDefaultFiles(appDir);

    console.log('[Init] App directory initialized:', appDir);
  } catch (err) {
    // Non-fatal: log and continue. The app may still work with partial init.
    console.error('[Init] First-run initialization failed:', err);
  }
}
