/**
 * Sandbox App Container Data Migration
 *
 * Handles migration of user data when moving from standard Unix ~/.sage/
 * to macOS App Store sandbox container ~/Library/Containers/{app-id}/Data/
 *
 * This is typically run on first launch after app update to MAS version.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Result of a migration operation
 */
interface MigrationResult {
  source: string;
  destination: string;
  success: boolean;
  itemCount: number;
  errors: string[];
}

/**
 * Check if we need to migrate from standard location to sandbox
 */
export async function shouldPerformSandboxMigration(): Promise<boolean> {
  try {
    const home = os.homedir();
    
    // Check if running in sandbox
    if (!home.includes('/Library/Containers/')) {
      return false; // Not in sandbox, no migration needed
    }
    
    // Check if old ~/.sage directory exists
    const oldSageDir = path.join(home.substring(0, home.indexOf('/Library/Containers')), '.sage');
    
    try {
      await fs.stat(oldSageDir);
      return true; // Old dir exists, should migrate
    } catch {
      return false; // Old dir doesn't exist
    }
  } catch (err) {
    console.warn('[SandboxMigration] Error checking migration necessity:', err);
    return false;
  }
}

/**
 * Recursively copy a directory, skipping certain files/directories
 */
async function copyDirectoryRecursive(
  sourceDir: string,
  destDir: string,
  skipPatterns: RegExp[] = []
): Promise<{ itemCount: number; errors: string[] }> {
  const errors: string[] = [];
  let itemCount = 0;

  try {
    await fs.mkdir(destDir, { recursive: true });

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip certain patterns
      if (skipPatterns.some((pattern) => pattern.test(entry.name))) {
        console.log(`[SandboxMigration] Skipping: ${entry.name}`);
        continue;
      }

      const sourcePath = path.join(sourceDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      try {
        if (entry.isDirectory()) {
          const result = await copyDirectoryRecursive(sourcePath, destPath, skipPatterns);
          itemCount += result.itemCount;
          errors.push(...result.errors);
        } else if (entry.isFile()) {
          await fs.copyFile(sourcePath, destPath);
          itemCount++;
          console.log(`[SandboxMigration] Copied: ${entry.name}`);
        }
      } catch (err) {
        const errorMsg = `Failed to copy ${entry.name}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.warn(`[SandboxMigration] ${errorMsg}`);
      }
    }
  } catch (err) {
    const errorMsg = `Failed to read directory ${sourceDir}: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(errorMsg);
  }

  return { itemCount, errors };
}

/**
 * Migrate user data from standard ~/.sage/ to sandbox container
 * 
 * Migration Strategy:
 * 1. Detect old ~/.sage directory (before /Library/Containers)
 * 2. Copy app directory structure to container
 * 3. Skip certain files (build artifacts, caches, node_modules)
 * 4. Preserve user configurations and data files
 * 5. Create marker file to prevent re-running migration
 */
export async function migrateToSandboxContainer(): Promise<MigrationResult> {
  const home = os.homedir();
  const sandboxAppDir = home;

  // Reconstruct old home path (remove everything after /Library/Containers)
  let oldHome = home;
  const containerPath = home.indexOf('/Library/Containers');
  if (containerPath !== -1) {
    // The old home was at the root of the user's home directory
    // Extract the user name from container path if needed
    oldHome = path.join(home.substring(0, containerPath - home.length), '..');
  }

  const oldSageDir = path.join(oldHome, '.sage');
  const newSageDir = path.join(sandboxAppDir, '.sage');

  console.log(`[SandboxMigration] Migrating from: ${oldSageDir}`);
  console.log(`[SandboxMigration] Migrating to:   ${newSageDir}`);

  const result: MigrationResult = {
    source: oldSageDir,
    destination: newSageDir,
    success: false,
    itemCount: 0,
    errors: [],
  };

  try {
    // Check if source exists
    try {
      await fs.stat(oldSageDir);
    } catch {
      console.log('[SandboxMigration] Source directory does not exist, skipping migration');
      result.success = true; // Not an error, just nothing to migrate
      return result;
    }

    // Check if destination already has .sage (migration may have already run)
    try {
      await fs.stat(newSageDir);
      console.log('[SandboxMigration] Destination already exists, checking for marker file');
      
      // Check for migration marker
      const markerPath = path.join(newSageDir, '.migration-complete');
      try {
        await fs.stat(markerPath);
        console.log('[SandboxMigration] Migration marker found, skipping');
        result.success = true;
        return result;
      } catch {
        // Marker doesn't exist, but destination exists - might be partial migration
        console.log('[SandboxMigration] Destination exists but no marker, may be incomplete');
      }
    } catch {
      // Destination doesn't exist, we'll create it
    }

    // Ensure destination parent exists
    await fs.mkdir(path.dirname(newSageDir), { recursive: true });

    // Files/patterns to skip during migration
    const skipPatterns = [
      /^\.migration-complete$/, // Our marker file
      /^\.git$/, // Git history
      /^\.DS_Store$/, // macOS metadata
      /^Thumbs\.db$/, // Windows metadata
      /^node_modules$/, // Dependencies (rebuild if needed)
      /^dist$/, // Build artifacts
      /^\.cache$/, // Cache files
      /^\.next$/, // Next.js build
      /^\.nuxt$/, // Nuxt build
      /^build$/, // Generic build
      /^\.turbo$/, // Turbo cache
      /package-lock\.json$/, // Lock files (rebuild)
      /yarn\.lock$/, // Yarn lock
    ];

    // Copy directory recursively
    const copyResult = await copyDirectoryRecursive(oldSageDir, newSageDir, skipPatterns);
    result.itemCount = copyResult.itemCount;
    result.errors = copyResult.errors;

    // Create migration marker file
    const markerPath = path.join(newSageDir, '.migration-complete');
    try {
      await fs.writeFile(
        markerPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            source: oldSageDir,
            destination: newSageDir,
          },
          null,
          2
        )
      );
      console.log('[SandboxMigration] Migration marker created');
    } catch (err) {
      console.warn('[SandboxMigration] Failed to create marker file:', err);
    }

    result.success = result.errors.length === 0;

    if (result.success) {
      console.log(
        `[SandboxMigration] ✓ Migration complete: ${result.itemCount} items copied`
      );
    } else {
      console.warn(
        `[SandboxMigration] ⚠ Migration completed with ${result.errors.length} errors`
      );
    }

    return result;
  } catch (err) {
    console.error('[SandboxMigration] Migration failed:', err);
    result.success = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}

/**
 * Validate migration success by checking critical directories
 */
export async function validateMigration(): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];
  const home = os.homedir();
  const appDir = home; // In sandbox, home is the app directory

  // Check for critical subdirectories
  const requiredDirs = ['skills', 'sessions', 'logs', 'cache', 'cron'];

  for (const subdir of requiredDirs) {
    const dirPath = path.join(appDir, '.sage', subdir);
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        issues.push(`${subdir} exists but is not a directory`);
      }
    } catch {
      // Directory doesn't exist - may be created on first use, so not always an error
      console.log(`[SandboxMigration] Note: ${subdir} not yet created`);
    }
  }

  // Check for critical config files
  const criticalFiles = ['config.json', 'AGENTS.md', 'SOUL.md'];
  for (const file of criticalFiles) {
    const filePath = path.join(appDir, '.sage', file);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        issues.push(`${file} exists but is not a file`);
      }
    } catch {
      console.log(`[SandboxMigration] Note: ${file} not yet created (may be created later)`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
