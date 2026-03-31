#!/usr/bin/env node
/**
 * Patch @modelcontextprotocol/sdk to add missing `discoverOAuthServerInfo` export
 * required by @shipany/open-agent-sdk.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..', '..');
const pnpmDir = join(workspaceRoot, 'node_modules', '.pnpm');

console.log('[patch-mcp-sdk] Searching in:', pnpmDir);

// Find all ESM auth.js files in MCP SDK
let authFiles = [];
try {
  const output = execSync(
    `find "${pnpmDir}" -name "auth.js" -path "*/sdk/dist/esm/client/*" -type f 2>/dev/null`,
    { encoding: 'utf-8' }
  ).trim();
  if (output) authFiles = output.split('\n').filter(Boolean);
} catch { /* ignore */ }

console.log(`[patch-mcp-sdk] Found ${authFiles.length} auth.js file(s)`);

let patched = 0;
const shimCode = `

// === Shim added by patch-mcp-sdk.mjs ===
// discoverOAuthServerInfo is required by @shipany/open-agent-sdk but
// does not exist in any published @modelcontextprotocol/sdk version.
export async function discoverOAuthServerInfo(serverUrl, opts) {
  // Delegate to discoverAuthorizationServerMetadata if it exists
  if (typeof discoverAuthorizationServerMetadata === 'function') {
    const authorizationServerMetadata = await discoverAuthorizationServerMetadata(serverUrl, opts);
    return { authorizationServerMetadata };
  }
  return { authorizationServerMetadata: null };
}
`;

for (const authFile of authFiles) {
  const content = readFileSync(authFile, 'utf-8');

  if (content.includes('discoverOAuthServerInfo')) {
    console.log(`[patch-mcp-sdk] Already has export: ${authFile}`);
    continue;
  }

  if (!content.includes('discoverAuthorizationServerMetadata')) {
    console.log(`[patch-mcp-sdk] No base function, skipping: ${authFile}`);
    continue;
  }

  writeFileSync(authFile, content + shimCode);
  patched++;
  console.log(`[patch-mcp-sdk] Patched: ${authFile}`);
}

console.log(`[patch-mcp-sdk] Done. Patched ${patched} file(s).`);
