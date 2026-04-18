/**
 * Path utilities for HT Claw API
 *
 * Uses ~/.htclaw/ as the standard data directory across all platforms.
 * This follows the Unix dotfile convention used by developer tools like:
 * - ~/.claude/ (Claude Code)
 * - ~/.npm/ (npm)
 * - ~/.docker/ (Docker)
 */

import * as os from 'os';
import * as path from 'path';

import {
  APP_DIR_NAME,
  CONFIG_FILE_NAME,
  MCP_CONFIG_FILE_NAME,
  SESSIONS_DIR_NAME,
  SKILLS_DIR_NAME,
} from '@/config/constants';

/**
 * Get the application data directory
 * Returns ~/.htclaw on all platforms
 */

export function getAppDataDir(): string {
  const home = os.homedir();
  return path.join(home, APP_DIR_NAME);
}

/**
 * Get the application config directory
 * Same as app data dir for simplicity
 */
export function getConfigDir(): string {
  return getAppDataDir();
}

/**
 * Get the default sessions directory
 */
export function getSessionsDir(): string {
  return path.join(getAppDataDir(), SESSIONS_DIR_NAME);
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
 * Get the default skills directory
 */
export function getSkillsDir(): string {
  return path.join(getAppDataDir(), SKILLS_DIR_NAME);
}

/**
 * Expand ~ to home directory
 */
export function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}
