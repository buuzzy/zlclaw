#!/usr/bin/env node
/**
 * Post-install patches for @shipany/open-agent-sdk dependency issues.
 *
 * 1. Patch @modelcontextprotocol/sdk: add missing `discoverOAuthServerInfo` shim
 * 2. Patch unicorn-magic: add missing "." export entry for tsx CJS compatibility
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..', '..');
const pnpmDir = join(workspaceRoot, 'node_modules', '.pnpm');

// ============================================================================
// Patch 1: @modelcontextprotocol/sdk — add discoverOAuthServerInfo shim
// ============================================================================

function patchMcpSdk() {
  let authFiles = [];
  try {
    const output = execSync(
      `find "${pnpmDir}" -name "auth.js" -path "*/sdk/dist/esm/client/*" -type f 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    if (output) authFiles = output.split('\n').filter(Boolean);
  } catch { /* ignore */ }

  const shimCode = `

// === Shim added by patch-deps.mjs ===
export async function discoverOAuthServerInfo(serverUrl, opts) {
  if (typeof discoverAuthorizationServerMetadata === 'function') {
    const authorizationServerMetadata = await discoverAuthorizationServerMetadata(serverUrl, opts);
    return { authorizationServerMetadata };
  }
  return { authorizationServerMetadata: null };
}
`;

  let patched = 0;
  for (const authFile of authFiles) {
    const content = readFileSync(authFile, 'utf-8');
    if (content.includes('discoverOAuthServerInfo')) continue;
    if (!content.includes('discoverAuthorizationServerMetadata')) continue;
    writeFileSync(authFile, content + shimCode);
    patched++;
  }
  console.log(`[patch-deps] MCP SDK: patched ${patched} of ${authFiles.length} auth.js file(s)`);
}

// ============================================================================
// Patch 2: unicorn-magic — add "." export for tsx CJS resolver compatibility
// ============================================================================

function patchUnicornMagic() {
  let pkgFiles = [];
  try {
    const output = execSync(
      `find "${pnpmDir}" -path "*/unicorn-magic/package.json" -type f 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    if (output) pkgFiles = output.split('\n').filter(Boolean);
  } catch { /* ignore */ }

  let patched = 0;
  for (const pkgFile of pkgFiles) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
      // unicorn-magic uses condition keys (node, default) instead of subpath keys (".")
      // Node.js exports can't mix both. Wrap into a "." subpath entry.
      if (pkg.exports && !pkg.exports['.'] && (pkg.exports.node || pkg.exports.default)) {
        const originalExports = { ...pkg.exports };
        pkg.exports = { '.': originalExports };
        writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
        patched++;
      }
    } catch { /* skip invalid package.json */ }
  }
  console.log(`[patch-deps] unicorn-magic: patched ${patched} of ${pkgFiles.length} package.json file(s)`);
}

// ============================================================================
// Run all patches
// ============================================================================

patchMcpSdk();
patchUnicornMagic();
console.log('[patch-deps] Done');
