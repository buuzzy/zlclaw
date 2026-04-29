/**
 * Sandbox Environment Detection and Utilities
 *
 * Detects when the application is running in a sandboxed environment
 * (e.g., macOS App Store sandbox) and provides utilities for sandbox-aware behavior.
 *
 * Key Concepts:
 * - Sandbox Detection: Multiple strategies to identify sandbox environment
 * - Path Mapping: Container-aware path resolution
 * - Feature Flags: Capability detection for sandbox-restricted features
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Sandbox Detection Strategies
// ============================================================================

/**
 * Check if running in macOS App Store sandbox
 * Strategy 1: Look for sandbox container path in HOME
 * Format: /var/folders/{xx}/{xxx}/T/AppTranslocation/{id}/d/... or
 *         ~/Library/Containers/{app-id}/Data/
 */
function detectMasAppStoreSandbox(): boolean {
  try {
    const home = os.homedir();
    
    // MAS sandbox container detection
    // Container path: ~/Library/Containers/{app-id}/Data/
    if (home.includes('/Library/Containers/')) {
      return true;
    }
    
    // Gatekeeper translocated app detection
    if (home.includes('/AppTranslocation/')) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if running in generic Tauri sandbox
 * Strategy 2: Look for Tauri-specific environment markers
 */
function detectTauriSandbox(): boolean {
  try {
    // Check for Tauri-specific environment variables
    if (process.env.TAURI_PLATFORM || process.env.TAURI_ENV_DEBUG) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if running with restricted file system access
 * Strategy 3: Test filesystem permissions by attempting to access common restricted paths
 */
function detectRestrictedFilesystem(): boolean {
  try {
    // Try to read system-wide ~/.env - restricted in sandbox
    const systemEnvPath = path.join(os.homedir(), '.env');
    // Don't actually try to read it - just check if we can stat it
    // In a strict sandbox, this may fail or be denied
    
    // For now, rely on explicit detection strategies above
    return false;
  } catch {
    return true; // Filesystem restriction detected
  }
}

/**
 * Check if running in any sandbox environment
 */
function isInSandbox(): boolean {
  return (
    detectMasAppStoreSandbox() ||
    detectTauriSandbox() ||
    detectRestrictedFilesystem()
  );
}

// ============================================================================
// Sandbox-Aware Path Resolution
// ============================================================================

/**
 * Detect the actual app data directory based on sandbox environment
 * - MAS: ~/Library/Containers/{app-id}/Data/
 * - Standard Unix: ~/.sage/
 * - Can be overridden by APP_DIR environment variable
 */
function detectAppDataDir(): string {
  // 1. Environment variable override (highest priority)
  if (process.env.SAGE_APP_DIR) {
    return process.env.SAGE_APP_DIR;
  }
  
  // 2. MAS sandbox detection
  if (detectMasAppStoreSandbox()) {
    // In MAS sandbox, home is already ~/Library/Containers/{app-id}/Data/
    // So we can use it directly
    return os.homedir();
  }
  
  // 3. Standard Unix convention
  return path.join(os.homedir(), '.sage');
}

/**
 * Get sandbox container identifier (e.g., for MAS app)
 */
function getSandboxContainerId(): string | null {
  try {
    const home = os.homedir();
    const match = home.match(/\/Library\/Containers\/([^/]+)\/Data/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a path is accessible in the current sandbox
 * Returns true if the path can be accessed, false otherwise
 */
function isPathAccessible(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the effective app directory considering sandbox constraints
 * This should be used instead of directly calling getAppDir() from constants
 */
function getEffectiveAppDir(): string {
  const appDir = detectAppDataDir();
  
  // Ensure the directory exists
  try {
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[Sandbox] Failed to ensure app dir exists: ${appDir}`, err);
  }
  
  return appDir;
}

// ============================================================================
// Sandbox Feature Flags
// ============================================================================

/**
 * Feature capabilities based on sandbox environment
 */
interface SandboxCapabilities {
  canAccessSystemEnv: boolean;
  canAccessClaudeCode: boolean;
  canAccessSystemPaths: boolean;
  canLoadExternalProcesses: boolean;
  requiresIpcForShell: boolean;
}

/**
 * Detect capabilities available in current sandbox
 */
function detectCapabilities(): SandboxCapabilities {
  const inSandbox = isInSandbox();
  const isMas = detectMasAppStoreSandbox();
  
  return {
    // MAS sandbox cannot read system-wide ~/.env files outside container
    canAccessSystemEnv: !inSandbox,
    
    // MAS sandbox cannot access other app's containers (~/.claude/)
    canAccessClaudeCode: !isMas,
    
    // MAS sandbox is restricted to specific system paths
    canAccessSystemPaths: !inSandbox,
    
    // MAS sandbox can still load external processes (sidecar)
    // but requires special entitlements
    canLoadExternalProcesses: true,
    
    // IPC needed for shell commands in strict sandbox
    requiresIpcForShell: isMas,
  };
}

// ============================================================================
// Public API
// ============================================================================

export const SandboxDetection = {
  // Detection methods
  isInSandbox,
  detectMasAppStoreSandbox,
  detectTauriSandbox,
  detectRestrictedFilesystem,
  getSandboxContainerId,
  
  // Path resolution
  detectAppDataDir,
  getEffectiveAppDir,
  isPathAccessible,
  
  // Capabilities
  detectCapabilities,
  
  // Utility
  getSandboxInfo(): {
    inSandbox: boolean;
    type: 'mas' | 'tauri' | 'unrestricted' | 'unknown';
    containerId: string | null;
    appDir: string;
    capabilities: SandboxCapabilities;
  } {
    const inSandbox = this.isInSandbox();
    let type: 'mas' | 'tauri' | 'unrestricted' | 'unknown' = 'unrestricted';
    
    if (this.detectMasAppStoreSandbox()) {
      type = 'mas';
    } else if (this.detectTauriSandbox()) {
      type = 'tauri';
    } else if (inSandbox) {
      type = 'unknown';
    }
    
    return {
      inSandbox,
      type,
      containerId: this.getSandboxContainerId(),
      appDir: this.getEffectiveAppDir(),
      capabilities: this.detectCapabilities(),
    };
  },
};

// Export individual functions for convenience
export {
  isInSandbox,
  detectMasAppStoreSandbox,
  getEffectiveAppDir,
  detectAppDataDir,
  getSandboxContainerId,
};
