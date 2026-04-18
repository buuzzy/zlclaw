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
 */
export const API_BASE_URL = `http://localhost:${API_PORT}`;

// =============================================================================
// App Configuration
// =============================================================================

/**
 * App name
 */
export const APP_NAME = 'HT Claw';

/**
 * App identifier (must match tauri.conf.json)
 */
export const APP_IDENTIFIER = 'ai.htclaw.app';
