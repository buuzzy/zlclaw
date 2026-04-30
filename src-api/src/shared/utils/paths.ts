/**
 * Path utilities for Sage API
 *
 * Uses ~/.sage/ as the standard data directory across all platforms.
 * Sandbox-aware: Automatically detects macOS App Store container and adapts paths.
 *
 * This follows the Unix dotfile convention used by developer tools like:
 * - ~/.claude/ (Claude Code)
 * - ~/.npm/ (npm)
 * - ~/.docker/ (Docker)
 *
 * In macOS App Store sandbox, the app directory is remapped to:
 * ~/Library/Containers/{app-id}/Data/
 */

import * as os from 'os';
import * as path from 'path';

import {
  APP_DIR_NAME,
  CONFIG_FILE_NAME,
  MCP_CONFIG_FILE_NAME,
  SESSIONS_DIR_NAME,
  SKILLS_DIR_NAME,
  getAppDir as getAppDirFromConstants,
  isRunningInSandbox,
} from '@/config/constants';

/**
 * Get the application data directory
 * Returns ~/.sage on standard systems, or ~/Library/Containers/{app-id}/Data/ in MAS sandbox
 * Can be overridden by SAGE_APP_DIR environment variable
 */
export function getAppDataDir(): string {
  return getAppDirFromConstants();
}

/**
 * Get the application config directory
 * Same as app data dir for simplicity
 */
export function getConfigDir(): string {
  return getAppDataDir();
}

/**
 * Get the sessions directory
 * Located at ~/.sage/sessions or container equivalent in sandbox
 */
export function getSessionsDir(): string {
  return path.join(getAppDataDir(), SESSIONS_DIR_NAME);
}

/**
 * Get the skills directory
 * Located at ~/.sage/skills or container equivalent in sandbox
 */
export function getSkillsDir(): string {
  return path.join(getAppDataDir(), SKILLS_DIR_NAME);
}

/**
 * Get the default config file path
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Get the default MCP config path
 */
export function getMcpConfigPath(): string {
  return path.join(getConfigDir(), MCP_CONFIG_FILE_NAME);
}

/**
 * Expand ~ to home directory
 * Also handles sandbox container paths transparently
 */
export function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

// ============================================================================
// Sandbox-specific path utilities
// ============================================================================

/**
 * Check if a path is within the sandbox-accessible app directory
 * Returns true if path is safely accessible in current environment
 */
export function isPathInAppDir(targetPath: string): boolean {
  const appDir = getAppDataDir();
  const normalizedTarget = path.resolve(targetPath);
  const normalizedAppDir = path.resolve(appDir);
  
  return normalizedTarget.startsWith(normalizedAppDir);
}

/**
 * Get the effective app directory with sandbox awareness
 * This function combines constants and paths modules for complete sandbox handling
 */
export function getEffectiveAppDir(): string {
  const appDir = getAppDataDir();
  
  try {
    // Ensure directory exists
    if (!require('fs').existsSync(appDir)) {
      require('fs').mkdirSync(appDir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[Paths] Failed to ensure app dir exists: ${appDir}`, err);
  }
  
  return appDir;
}

/**
 * Get all required app subdirectories
 * Returns array of subdirectory names that should exist in the app directory
 */
export function getRequiredAppDirs(): string[] {
  return [
    'skills',      // Built-in and custom skills
    'sessions',    // Session files and context
    'logs',        // Application logs
    'cache',       // Cache files
    'cron',        // Cron jobs configuration
  ];
}

/**
 * Get the path for a specific app subdirectory
 */
export function getAppSubdir(name: string): string {
  return path.join(getAppDataDir(), name);
}

/**
 * Debug utility: Get sandbox information
 * Useful for logging and diagnostics
 */
export function getSandboxDebugInfo(): {
  inSandbox: boolean;
  appDir: string;
  homeDir: string;
} {
  return {
    inSandbox: isRunningInSandbox(),
    appDir: getAppDataDir(),
    homeDir: os.homedir(),
  };
}
