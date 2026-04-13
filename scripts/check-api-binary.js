#!/usr/bin/env node

/**
 * Pre-flight check for API sidecar binary.
 * If the binary doesn't exist, automatically builds it.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const platformMap = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' };
const triple = `${arch}-${platformMap[process.platform]}`;
const binaryName = `workany-api-${triple}${process.platform === 'win32' ? '.exe' : ''}`;
const binaryPath = resolve(root, 'src-api/dist', binaryName);

if (existsSync(binaryPath)) {
  console.log(`\x1b[32m✓ API sidecar binary found: ${binaryName}\x1b[0m`);
} else {
  console.log(`\x1b[33m⚠ API sidecar binary not found: ${binaryName}\x1b[0m`);
  console.log(`\x1b[36m  Building API binary...\x1b[0m`);
  try {
    execSync('pnpm build:api:binary', { cwd: root, stdio: 'inherit' });
    console.log(`\x1b[32m✓ API sidecar binary built successfully\x1b[0m`);
  } catch {
    console.error(`\x1b[31m✗ Failed to build API binary. Run "pnpm build:api:binary" manually.\x1b[0m`);
    process.exit(1);
  }
}
