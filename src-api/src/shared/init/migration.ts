/**
 * Data Migration from HTclaw to Sage
 * 
 * Handles migration of user data from ~/.htclaw/ to ~/.sage/
 * Run only once - subsequent runs are no-op due to marker file check.
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const OLD_APP_DIR = join(homedir(), '.htclaw');
const NEW_APP_DIR = join(homedir(), '.sage');
const MIGRATION_MARKER = join(NEW_APP_DIR, '.migrated_from_htclaw');

/**
 * Migrate user data from ~/.htclaw/ to ~/.sage/
 * This is idempotent - only runs if:
 *  1. Old directory exists
 *  2. New directory exists (created by ensureDirectories)
 *  3. Migration marker doesn't exist
 */
export async function migrateFromHTclaw(): Promise<void> {
  // Already migrated?
  if (existsSync(MIGRATION_MARKER)) {
    return;
  }

  // Nothing to migrate?
  if (!existsSync(OLD_APP_DIR)) {
    return;
  }

  // New directory must exist first (created by ensureDirectories)
  if (!existsSync(NEW_APP_DIR)) {
    return;
  }

  try {
    console.log(`[Init] Migrating data from ${OLD_APP_DIR} to ${NEW_APP_DIR}...`);

    // Copy all files and subdirectories from old to new
    // Skip if they already exist in new location (preserve any newer configs)
    const entries = await fs.readdir(OLD_APP_DIR, { withFileTypes: true });
    
    for (const entry of entries) {
      const oldPath = join(OLD_APP_DIR, entry.name);
      const newPath = join(NEW_APP_DIR, entry.name);

      // Skip if already exists in new location
      if (existsSync(newPath)) {
        console.log(`[Init] Skipping existing: ${entry.name}`);
        continue;
      }

      try {
        if (entry.isDirectory()) {
          // Recursively copy directories
          await fs.cp(oldPath, newPath, { recursive: true });
        } else {
          // Copy files
          await fs.copyFile(oldPath, newPath);
        }
        console.log(`[Init] Migrated: ${entry.name}`);
      } catch (err) {
        console.warn(`[Init] Failed to migrate ${entry.name}:`, err);
      }
    }

    // Write migration marker to prevent re-running
    await fs.writeFile(MIGRATION_MARKER, `Migrated from HTclaw on ${new Date().toISOString()}\n`);
    console.log('[Init] Migration complete. Marker written.');
    console.log(`[Init] Old directory ${OLD_APP_DIR} can now be safely deleted.`);
  } catch (err) {
    console.error('[Init] Migration failed:', err);
    // Non-fatal: continue startup even if migration fails
  }
}
