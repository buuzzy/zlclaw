/**
 * First-Run Initialization
 *
 * Ensures ~/.sage/ (or sandbox container equivalent) is fully set up before the server starts.
 * This runs on every startup but is idempotent — it only creates
 * files and directories that don't already exist, never overwriting
 * user data.
 *
 * Sandbox-aware: Automatically adapts to macOS App Store container paths via
 * SAGE_APP_DIR environment variable or automatic detection in constants.ts
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
import { getAppDir, isRunningInSandbox } from '@/config/constants';
import {
  shouldPerformSandboxMigration,
  migrateToSandboxContainer,
  validateMigration,
} from './sandbox-migration';
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
  '',          // ~/.sage/ or sandbox container itself
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
    // NOTE: .env is intentionally NOT copied here. Environment variable injection
    // must happen BEFORE the sidecar process starts, otherwise this process's
    // process.env is already frozen and the copied .env has no effect this run.
    // The Tauri Rust shell (src-tauri/src/lib.rs) handles loading + mirroring
    // the bundled defaults/.env to ~/.sage/.env at spawn time.
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
 *   1. Detect app directory (sandbox-aware via getAppDir())
 *   2. Ensure all required directories exist
 *   3. Migrate user data from ~/.htclaw/ (if upgrading from HTclaw)
 *   4. Install bundled default files and create skeleton files
 */
export async function ensureAppDirInitialized(): Promise<void> {
  const appDir = getAppDir();

  // Log sandbox status for diagnostics
  if (isRunningInSandbox()) {
    console.log('[Init] Running in sandbox environment');
    console.log(`[Init] App directory: ${appDir}`);
    
    // Check if data migration from standard location is needed
    if (await shouldPerformSandboxMigration()) {
      console.log('[Init] Performing sandbox data migration...');
      const migrationResult = await migrateToSandboxContainer();
      if (migrationResult.success) {
        console.log(`[Init] ✓ Migration successful: ${migrationResult.itemCount} items migrated`);
      } else {
        console.warn('[Init] ⚠ Migration had issues:', migrationResult.errors);
      }
      
      // Validate migration
      const validation = await validateMigration();
      if (!validation.valid) {
        console.warn('[Init] ⚠ Migration validation issues:', validation.issues);
      }
    }
  }

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
