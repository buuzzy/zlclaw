/**
 * Application Constants
 *
 * Centralized configuration constants for the Sage API.
 * All hardcoded values should be defined here for easy management.
 * 
 * Sandbox-aware: Supports environment variable overrides for sandbox
 * environments (e.g., macOS App Store container paths).
 */

import { homedir } from 'os';
import { join } from 'path';

// ============================================================================
// Application Identity
// ============================================================================

/** Application name */
export const APP_NAME = 'sage';

/** Application data directory name (used in home directory) */
export const APP_DIR_NAME = '.sage';

/** Claude Code directory name (system config) */
export const CLAUDE_DIR_NAME = '.claude';

// ============================================================================
// Server Configuration
// ============================================================================

/** Default API server port */
export const DEFAULT_API_PORT = 2620;

/** Default API server host */
export const DEFAULT_API_HOST = 'localhost';

// ============================================================================
// Directory Structure
// ============================================================================

/** Default work directory path (relative to home) */
export const DEFAULT_WORK_DIR = `~/${APP_DIR_NAME}`;

/** Sessions subdirectory name */
export const SESSIONS_DIR_NAME = 'sessions';

/** Skills subdirectory name */
export const SKILLS_DIR_NAME = 'skills';

/** Logs subdirectory name */
export const LOGS_DIR_NAME = 'logs';

/** Cache subdirectory name */
export const CACHE_DIR_NAME = 'cache';

// ============================================================================
// Configuration Files
// ============================================================================

/** Main config filename */
export const CONFIG_FILE_NAME = 'config.json';

/** MCP config filename */
export const MCP_CONFIG_FILE_NAME = 'mcp.json';

/** Config file search paths (relative) */
export const CONFIG_SEARCH_PATHS = [
  './sage.config.json',
  './config/sage.json',
];

// ============================================================================
// Default Provider Settings
// ============================================================================

/** Default sandbox provider type */
export const DEFAULT_SANDBOX_PROVIDER = 'codex';

/** Default agent provider type */
export const DEFAULT_AGENT_PROVIDER = 'codeany';

/** Default agent model */
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-20250514';

/** Default CodeAny agent model */
export const DEFAULT_CODEANY_MODEL = 'claude-sonnet-4-20250514';

// ============================================================================
// Timeouts and Limits
// ============================================================================

/** Default script execution timeout (ms) */
export const DEFAULT_SCRIPT_TIMEOUT = 120000;

/** Default API request timeout (ms) */
export const DEFAULT_API_TIMEOUT = 30000;

/** Maximum sandbox pool size */
export const DEFAULT_SANDBOX_POOL_SIZE = 5;

// ============================================================================
// Network Configuration
// ============================================================================

/** Sandbox API port (internal) */
export const SANDBOX_API_PORT = 2620;

/** Get sandbox API URL */
export function getSandboxApiUrl(): string {
  return (
    process.env.SANDBOX_API_URL ||
    `http://${DEFAULT_API_HOST}:${SANDBOX_API_PORT}`
  );
}

// ============================================================================
// Path Helpers (cross-platform compatible, sandbox-aware)
// ============================================================================

/** Get user home directory */
export function getHomeDir(): string {
  return homedir();
}

/**
 * Get Sage app data directory
 * 
 * Sandbox-aware: Checks SAGE_APP_DIR environment variable first.
 * This allows macOS App Store sandbox to override with ~/Library/Containers/{app-id}/Data/
 * 
 * Priority order:
 * 1. SAGE_APP_DIR environment variable (explicit override)
 * 2. ~/.sage/ (default Unix convention)
 */
export function getAppDir(): string {
  // Allow sandbox or deployment-specific override via environment variable
  if (process.env.SAGE_APP_DIR) {
    return process.env.SAGE_APP_DIR;
  }
  
  return join(homedir(), APP_DIR_NAME);
}

/** Get Claude Code directory */
export function getClaudeDir(): string {
  return join(homedir(), CLAUDE_DIR_NAME);
}

/** Get Sage skills directory */
export function getWorkanySkillsDir(): string {
  return join(getAppDir(), SKILLS_DIR_NAME);
}

/** Get Claude skills directory */
export function getClaudeSkillsDir(): string {
  return join(getClaudeDir(), SKILLS_DIR_NAME);
}

/** Get all skills directories to search */
export function getAllSkillsDirs(): { name: string; path: string }[] {
  return [
    { name: 'sage', path: getWorkanySkillsDir() },
    { name: 'claude', path: getClaudeSkillsDir() },
  ];
}

/** Get Sage MCP config path */
export function getWorkanyMcpConfigPath(): string {
  return join(getAppDir(), MCP_CONFIG_FILE_NAME);
}

/** Get Claude settings path (contains MCP config) */
export function getClaudeSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json');
}

/** Get all MCP config paths to search */
export function getAllMcpConfigPaths(): { name: string; path: string }[] {
  return [
    { name: 'sage', path: getWorkanyMcpConfigPath() },
    { name: 'claude', path: getClaudeSettingsPath() },
  ];
}

// ============================================================================
// Sandbox Environment
// ============================================================================

/**
 * Check if running in a sandboxed environment (lazy initialization)
 * Caches the result for performance
 */
let _sandboxDetectCache: boolean | null = null;

export function isRunningInSandbox(): boolean {
  if (_sandboxDetectCache !== null) {
    return _sandboxDetectCache;
  }
  
  try {
    const home = homedir();
    
    // macOS App Store sandbox detection
    // Container path: ~/Library/Containers/{app-id}/Data/
    if (home.includes('/Library/Containers/')) {
      _sandboxDetectCache = true;
      return true;
    }
    
    // Gatekeeper translocated app detection
    if (home.includes('/AppTranslocation/')) {
      _sandboxDetectCache = true;
      return true;
    }
    
    _sandboxDetectCache = false;
    return false;
  } catch {
    _sandboxDetectCache = false;
    return false;
  }
}

/**
 * Get sandbox container identifier (e.g., "ai.sage.desktop" for MAS)
 * Returns null if not running in a sandbox container
 */
export function getSandboxContainerId(): string | null {
  try {
    const home = homedir();
    const match = home.match(/\/Library\/Containers\/([^/]+)\/Data/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}
