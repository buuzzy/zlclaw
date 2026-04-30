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

  // Create skeleton files with minimal content.
  // Phase 2 起不再创建 user.md / MEMORY.md：历史记忆全部走云端 supabase
  // + mcp__memory__search_memory 工具，无需本地长期记忆文件。
  await writeIfMissing(
    join(appDir, 'mcp.json'),
    JSON.stringify({ mcpServers: {} }, null, 2) + '\n',
  );
}

/**
 * Phase 2 一次性清理：删除旧的本地记忆文件（user.md / MEMORY.md /
 * memory/ 目录 / memory-index/ 目录）。这些文件来自旧的「日 md +
 * embedding 索引」体系，现在已被 supabase 云端记忆 + 工具召回取代。
 *
 * 这是 destructive 操作但安全：所有用户对话已通过 messages-sync 双写到
 * 云端，本地 md 只是冗余拷贝。清理后 sidecar 不会再把它们注入 prompt。
 *
 * 幂等：文件不存在也不报错。
 */
async function cleanupLegacyMemoryFiles(appDir: string): Promise<void> {
  const targets = [
    join(appDir, 'user.md'),
    join(appDir, 'MEMORY.md'),
    join(appDir, 'MEMORY.md.bak'),
    join(appDir, 'memory'),
    join(appDir, 'memory-index'),
  ];

  for (const path of targets) {
    if (!existsSync(path)) continue;
    try {
      await fs.rm(path, { recursive: true, force: true });
      console.log(`[Init] Removed legacy memory artifact: ${path}`);
    } catch (err) {
      console.warn(`[Init] Failed to remove ${path}:`, err);
    }
  }
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
 *   5. Phase 2: cleanup legacy memory artifacts (user.md / MEMORY.md / memory/ / memory-index/)
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
    //    and create skeleton files (mcp.json)
    await installDefaultFiles(appDir);

    // 4. Phase 2: 清理旧的本地记忆文件（如果存在）
    await cleanupLegacyMemoryFiles(appDir);

    console.log('[Init] App directory initialized:', appDir);
  } catch (err) {
    // Non-fatal: log and continue. The app may still work with partial init.
    console.error('[Init] First-run initialization failed:', err);
  }
}
