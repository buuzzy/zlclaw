#!/usr/bin/env node
/**
 * Custom esbuild bundle script.
 *
 * Resolves pnpm's strict node_modules structure by adding
 * the .pnpm virtual store to NODE_PATH so esbuild can find
 * hoisted-but-not-linked packages like @larksuiteoapi/node-sdk.
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const workspaceRoot = resolve(rootDir, '..');

// Find the pnpm virtual store path for @larksuiteoapi/node-sdk
const pnpmStore = resolve(workspaceRoot, 'node_modules', '.pnpm');
let larkNodeModules = '';

if (existsSync(pnpmStore)) {
  const entries = readdirSync(pnpmStore);
  const larkEntry = entries.find(e => e.startsWith('@larksuiteoapi+node-sdk'));
  if (larkEntry) {
    larkNodeModules = resolve(pnpmStore, larkEntry, 'node_modules');
  }
}

// Build the esbuild command - use pnpm exec to find the binary
const cmd = [
  'pnpm', 'exec', 'esbuild',
  'src/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--outfile=dist/bundle.cjs',
];

// If we found the lark SDK in pnpm store, add its node_modules as a resolve path
if (larkNodeModules && existsSync(larkNodeModules)) {
  cmd.push(`--resolve-extensions=.ts,.js,.json,.node`);
  // Use alias to point esbuild to the correct location
  cmd.push(`--alias:@larksuiteoapi/node-sdk=${resolve(larkNodeModules, '@larksuiteoapi', 'node-sdk')}`);
  console.log(`[bundle] Found lark SDK at: ${larkNodeModules}`);
}

console.log(`[bundle] Running: ${cmd.join(' ')}`);

try {
  execSync(cmd.join(' '), {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_PATH: larkNodeModules ? `${larkNodeModules}:${process.env.NODE_PATH || ''}` : process.env.NODE_PATH || '',
    },
  });
  console.log('[bundle] Success');
} catch (err) {
  process.exit(1);
}
