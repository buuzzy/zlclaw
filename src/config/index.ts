/**
 * Application Configuration
 *
 * Centralized configuration for the application.
 */

// =============================================================================
// API Configuration
// =============================================================================

/**
 * API port — unified at 2026 for both dev and production.
 * WeClaw and other channel integrations always connect to this port.
 */
export const API_PORT = 2026;

/**
 * API base URL
 *
 * Tauri desktop: connects to local sidecar at localhost:2026
 * iOS / Web:     connects to cloud backend via VITE_API_URL env var
 */
const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const API_BASE_URL = isTauri
  ? `http://localhost:${API_PORT}`
  : (import.meta.env.VITE_API_URL || `http://localhost:${API_PORT}`);

// =============================================================================
// App Configuration
// =============================================================================

/**
 * App name（用户可见品牌名）
 *
 * 注：底层 identifier / 目录名 / scheme 保持 `sage` 不变（见 `APP_IDENTIFIER`、
 * `~/.sage/` 目录、`sage://` deep link），只有面向用户的显示名用中文品牌。
 */
export const APP_NAME = '涨乐金融龙虾';

/**
 * App identifier (must match tauri.conf.json)
 */
export const APP_IDENTIFIER = 'ai.sage.app';
