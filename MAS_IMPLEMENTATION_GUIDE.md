# Mac App Store Sandbox Implementation Guide

## Quick Reference: What Breaks in Sandbox

| Feature | Current | In Sandbox | Fix |
|---------|---------|-----------|-----|
| `~/.sage/` data | ✓ Works | ✗ No access | Move to `~/Library/Application Support/ai.sage.desktop/` |
| `~/.claude/` integration | ✓ Works | ✗ No access | Disable or use protocol |
| `lsof` / `kill` commands | ✓ Works | ✗ Blocked | Remove port killing logic |
| `.env` from home | ✓ Works | ✗ No access | Load from app container only |
| `sage.db` location | ? Unknown | ✗ If in home | Verify and move to container |
| Sidecar spawning | ✓ Works | ⚠️ Unrestricted | Add sandbox entitlements |

---

## Step-by-Step Implementation

### Step 1: Verify Database Location (5 minutes)

**Goal**: Confirm where `sage.db` actually lives

Add debug logging to `src-tauri/src/lib.rs`:

```rust
// In the setup() function, add:
#[cfg(not(debug_assertions))]
{
    if let Ok(data_dir) = app.path().app_data_dir() {
        println!("[Setup] App data dir: {}", data_dir.display());
    }
    if let Ok(config_dir) = app.path().app_config_dir() {
        println!("[Setup] App config dir: {}", config_dir.display());
    }
}
```

Then:
```bash
cd src-tauri
pnpm tauri build
# Look for output: [Setup] App data dir: ...
```

**Expected output**:
- App data dir: `~/Library/Application Support/ai.sage.desktop`
- App config dir: `~/Library/Application Support/ai.sage.desktop`

**Database location verification**:
```bash
find ~/Library/Application\ Support/ -name "sage.db" -o -name "*.sqlite"
```

---

### Step 2: Create Feature-Gated Paths (30 minutes)

**Goal**: Support both non-sandbox (home dir) and sandbox (app container) paths

**File**: `src-api/src/config/constants.ts`

```typescript
/**
 * Get the application data directory.
 * 
 * - Non-sandbox: ~/.sage/ (with fallback to HOME env var)
 * - Sandbox (MAS): ~/Library/Application Support/ai.sage.desktop/ (via SAGE_APP_DIR)
 */
export function getAppDir(): string {
  // If running in sandbox, Tauri will pass this env var
  if (process.env.SAGE_APP_DIR) {
    return process.env.SAGE_APP_DIR;
  }
  
  // Non-sandbox (standard mode)
  return join(homedir(), APP_DIR_NAME);
}

/**
 * Get the application cache directory.
 * Used for temporary data (embeddings, vector index, etc.)
 */
export function getAppCacheDir(): string {
  if (process.env.SAGE_CACHE_DIR) {
    return process.env.SAGE_CACHE_DIR;
  }
  
  return join(getAppDir(), 'cache');
}

/**
 * Get the application data directory (databases, sessions, skills).
 * Distinct from app dir to support different storage strategies.
 */
export function getAppDataDir(): string {
  if (process.env.SAGE_DATA_DIR) {
    return process.env.SAGE_DATA_DIR;
  }
  
  return join(getAppDir(), 'data');
}
```

**Update all path functions to use the new structure**:

```typescript
// Example: getWorkanySkillsDir
export function getWorkanySkillsDir(): string {
  return join(getAppDataDir(), SKILLS_DIR_NAME);  // changed from getAppDir()
}

// Example: getSessionsDir
export function getSessionsDir(): string {
  return join(getAppDataDir(), SESSIONS_DIR_NAME);
}
```

---

### Step 3: Pass Paths from Tauri to Sidecar (30 minutes)

**Goal**: Tell sidecar where to store data

**File**: `src-tauri/src/lib.rs`

Replace the `env_paths` loop (lines 255-262) with explicit path passing:

```rust
#[cfg(not(debug_assertions))]
{
    const API_PORT: u16 = 2026;
    
    // Get app container directories
    let app_config_dir = app.path().app_config_dir().ok().map(|p| p.to_string_lossy().to_string());
    let app_data_dir = app_config_dir.as_ref().map(|d| format!("{}/data", d));
    let app_cache_dir = app_config_dir.as_ref().map(|d| format!("{}/cache", d));
    
    // Create directories if they don't exist
    if let Some(ref config_dir) = app_config_dir {
        let _ = std::fs::create_dir_all(config_dir);
        if let Some(ref data_dir) = app_data_dir {
            let _ = std::fs::create_dir_all(data_dir);
        }
        if let Some(ref cache_dir) = app_cache_dir {
            let _ = std::fs::create_dir_all(cache_dir);
        }
    }
    
    // Kill any existing process on the API port
    kill_existing_api_process(API_PORT);
    
    // Build sidecar command with proper environment
    let mut sidecar_command = app.shell().sidecar("sage-api")
        .unwrap()
        .env("PORT", API_PORT.to_string())
        .env("NODE_ENV", "production");
    
    // Pass paths to sidecar
    if let Some(config_dir) = app_config_dir {
        sidecar_command = sidecar_command
            .env("SAGE_APP_DIR", config_dir)
            .env("SAGE_DATA_DIR", app_data_dir.unwrap_or_default())
            .env("SAGE_CACHE_DIR", app_cache_dir.unwrap_or_default());
    }
    
    // Load .env from app config directory only (no home dir access)
    let env_path = app_config_dir.as_ref().map(|d| format!("{}/.env", d));
    if let Some(env_path) = env_path {
        if Path::new(&env_path).exists() {
            println!("[API] Loading .env from: {}", env_path);
            let pairs = load_dotenv(Path::new(&env_path));
            for (key, value) in pairs {
                sidecar_command = sidecar_command.env(&key, &value);
                println!("[API] Injected env: {}", key);
            }
        }
    }
    
    let (mut rx, child) = sidecar_command.spawn()
        .expect("Failed to spawn API sidecar");
    
    // Store and manage sidecar...
}
```

---

### Step 4: Remove Home Directory Access (30 minutes)

**Goal**: Eliminate all `homedir()` calls in backend (except as fallback)

**Files to update**:

1. **`src-api/src/config/constants.ts`**
   - Already done in Step 2

2. **`src-api/src/config/prompt-loader.ts`**
   - Uses `getAppDir()` ✓ Already correct after Step 2

3. **`src-api/src/shared/init/first-run.ts`**
   - Uses `getAppDir()` ✓ Already correct

4. **`src-api/src/app/api/files.ts`**
   - Remove `homedir()` calls
   - Change home expansion from:
     ```typescript
     const homedir = getHomeDir();
     if (filePath.startsWith('~/')) {
       filePath = filePath.replace(/^~/, homedir);
     }
     ```
   - To:
     ```typescript
     // In sandbox, disable home expansion
     // In non-sandbox, allow it
     if (!process.env.SAGE_APP_DIR) {
       const homedir = getHomeDir();
       if (filePath.startsWith('~/')) {
         filePath = filePath.replace(/^~/, homedir);
       }
     } else {
       // Sandbox: only relative paths or app dir paths
       if (filePath.startsWith('~/')) {
         throw new Error('Cannot access home directory in sandboxed mode');
       }
     }
     ```

5. **`src-api/src/app/api/mcp.ts`**
   - Remove `.claude` directory access
   ```typescript
   // BEFORE
   export function getAllMcpConfigPaths(): { name: string; path: string }[] {
     return [
       { name: 'sage', path: getWorkanyMcpConfigPath() },
       { name: 'claude', path: getClaudeSettingsPath() },  // DELETE THIS
     ];
   }
   
   // AFTER
   export function getAllMcpConfigPaths(): { name: string; path: string }[] {
     const paths = [{ name: 'sage', path: getWorkanyMcpConfigPath() }];
     
     // Only add Claude config if not in sandbox
     if (!process.env.SAGE_APP_DIR) {
       paths.push({ name: 'claude', path: getClaudeSettingsPath() });
     }
     
     return paths;
   }
   ```

6. **`src-api/src/config/constants.ts`**
   - Update `getAllSkillsDirs()`:
   ```typescript
   export function getAllSkillsDirs(): { name: string; path: string }[] {
     const dirs = [{ name: 'sage', path: getWorkanySkillsDir() }];
     
     // Only add Claude skills if not in sandbox
     if (!process.env.SAGE_APP_DIR) {
       dirs.push({ name: 'claude', path: getClaudeSkillsDir() });
     }
     
     return dirs;
   }
   ```

---

### Step 5: Eliminate Process Killing (15 minutes)

**Goal**: Remove the `kill_existing_api_process()` function for sandbox

**File**: `src-tauri/src/lib.rs`

**Strategy 1: Conditional compilation**
```rust
// Only use kill_existing_api_process in non-sandbox mode
#[cfg(all(not(debug_assertions), not(target_os = "macos")))]
kill_existing_api_process(API_PORT);

// For macOS MAS (sandbox), implement health check instead:
#[cfg(all(not(debug_assertions), target_os = "macos"))]
{
    // Try to connect to existing sidecar first
    if let Ok(_) = reqwest::Client::new()
        .get("http://127.0.0.1:2026/health")
        .timeout(Duration::from_secs(1))
        .send()
        .block_on()
    {
        println!("[API] Sidecar already running on port 2026");
        // Reuse existing connection, skip spawn
        return Ok(());
    }
}
```

**Strategy 2: Port retry with fallback**
```rust
// Try ports in sequence
const PORTS_TO_TRY: &[u16] = &[2026, 2027, 2028, 2029];
let mut api_port = 2026;

for port in PORTS_TO_TRY {
    match std::net::TcpListener::bind(("127.0.0.1", *port)) {
        Ok(listener) => {
            api_port = *port;
            drop(listener);  // Release the port
            println!("[API] Using port: {}", port);
            break;
        }
        Err(_) => continue,
    }
}
```

---

### Step 6: Update Entitlements for Sandbox (30 minutes)

**Goal**: Add sandbox profile while keeping app functional

**File**: `src-tauri/entitlements.plist`

Replace with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- ========================================
         REQUIRED: Enable App Sandbox
         ======================================== -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    
    <!-- ========================================
         CODE SIGNING: Allow JIT and unsigned code for Node.js
         ======================================== -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    
    <!-- ========================================
         NETWORK: localhost only (for sidecar communication)
         ======================================== -->
    <key>com.apple.security.network.client</key>
    <true/>
    
    <key>com.apple.security.network.server</key>
    <true/>
    
    <!-- ========================================
         FILE SYSTEM: App container only
         ======================================== -->
    <!-- Read/write access to app's own container (automatic in sandbox) -->
    
    <!-- Allow reading user-selected files (file open dialogs) -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    
    <!-- Allow read/write access to Downloads folder for exports -->
    <key>com.apple.security.files.downloads-folder-level</key>
    <string>read-write</string>
    
    <!-- ========================================
         OPTIONAL: Environment
         ======================================== -->
    <!-- Allow access to user's home directory for reading (if needed) -->
    <!-- <key>com.apple.security.files.home-relative-path.read-only</key> -->
    <!-- <true/> -->
    
    <!-- Remove hypervisor/virtualization (NOT allowed in MAS) -->
    <!-- They were in original, delete them -->
</dict>
</plist>
```

**Note**: Keep `com.apple.security.app-sandbox = false` for non-MAS releases.

---

### Step 7: Update Tauri Config for Directories (15 minutes)

**Goal**: Explicitly configure where app stores data

**File**: `src-tauri/tauri.conf.json`

Add directories section:

```json
{
  "app": {
    "directories": {
      "configDir": "config",
      "dataDir": "data",
      "cacheDir": "cache",
      "logsDir": "logs"
    }
  }
}
```

This tells Tauri and plugins where to put their files (within `~/Library/Application Support/ai.sage.desktop/`).

---

### Step 8: Data Migration Strategy (1 hour)

**Goal**: Move existing `~/.sage/` data to new location on first run

**File**: `src-api/src/shared/init/migration.ts` (new)

```typescript
/**
 * Migrate data from ~/.sage/ to ~/Library/Application Support/ai.sage.desktop/
 * Runs on first launch if SAGE_APP_DIR is set (indicating sandbox/MAS)
 */

import { existsSync } from 'fs';
import { cp } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export async function migrateFromHomeDir(): Promise<void> {
  // Only run in sandbox mode
  if (!process.env.SAGE_APP_DIR) {
    return;  // Non-sandbox: data already in ~/.sage/
  }
  
  const oldDir = join(homedir(), '.sage');
  const newDir = process.env.SAGE_APP_DIR;
  
  // Check if old dir exists
  if (!existsSync(oldDir)) {
    console.log('[Migration] No legacy ~/.sage/ to migrate');
    return;
  }
  
  // Check if new dir already has data (don't overwrite)
  const newDataDir = join(newDir, 'data');
  if (existsSync(newDataDir)) {
    console.log('[Migration] New data directory already exists, skipping migration');
    return;
  }
  
  try {
    console.log(`[Migration] Migrating data from ${oldDir} to ${newDir}`);
    
    // Copy skills
    const oldSkills = join(oldDir, 'skills');
    if (existsSync(oldSkills)) {
      await cp(oldSkills, join(newDir, 'data', 'skills'), { recursive: true });
      console.log('[Migration] Migrated skills/');
    }
    
    // Copy sessions
    const oldSessions = join(oldDir, 'sessions');
    if (existsSync(oldSessions)) {
      await cp(oldSessions, join(newDir, 'data', 'sessions'), { recursive: true });
      console.log('[Migration] Migrated sessions/');
    }
    
    // Copy memory
    const oldMemory = join(oldDir, 'memory');
    if (existsSync(oldMemory)) {
      await cp(oldMemory, join(newDir, 'data', 'memory'), { recursive: true });
      console.log('[Migration] Migrated memory/');
    }
    
    // Copy config files
    for (const file of ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'user.md', 'mcp.json']) {
      const src = join(oldDir, file);
      if (existsSync(src)) {
        await cp(src, join(newDir, file));
        console.log(`[Migration] Migrated ${file}`);
      }
    }
    
    console.log('[Migration] Data migration complete');
  } catch (err) {
    console.error('[Migration] Failed:', err);
    // Non-fatal: continue anyway
  }
}
```

Call this in `first-run.ts`:

```typescript
export async function ensureAppDirInitialized(): Promise<void> {
  // ... existing code ...
  
  // NEW: Migrate from home dir if needed
  await migrateFromHomeDir();
  
  // ... rest of init ...
}
```

---

### Step 9: Build Configuration for MAS (30 minutes)

**Goal**: Create separate build scripts for MAS vs. standard

**File**: `src-tauri/build.rs` (new or update)

```rust
fn main() {
    // Let Tauri handle the rest
    tauri_build::build()
}
```

**File**: `package.json` (add scripts)

```json
{
  "scripts": {
    "tauri:build": "tauri build",
    "tauri:build:mas": "tauri build --target universal-apple-darwin -- --features mas",
    "tauri:build:dev": "tauri dev",
    "tauri:sign:mas": "scripts/sign-mas.sh"
  }
}
```

**File**: `scripts/sign-mas.sh` (new)

```bash
#!/bin/bash
# Sign and prepare for Mac App Store

set -e

APP_PATH="src-tauri/target/universal-apple-darwin/release/bundle/macos/Sage.app"
SIDECAR_PATH="$APP_PATH/Contents/MacOS/sage-api"
ENTITLEMENTS="src-tauri/entitlements.plist"
TEAM_ID="${TEAM_ID:?Set TEAM_ID env var}"

echo "[Sign] Signing sidecar..."
codesign --force --sign "-" \
  --entitlements "$ENTITLEMENTS" \
  "$SIDECAR_PATH"

echo "[Sign] Signing app..."
codesign --force --sign "-" \
  --entitlements "$ENTITLEMENTS" \
  --timestamp \
  "$APP_PATH"

echo "[Sign] Complete. Ready for Mac App Store submission."
```

---

### Step 10: Testing Checklist (2+ hours)

**Non-Sandbox Tests** (ensure no regression):

- [ ] Start app in dev mode
- [ ] Verify data in `~/.sage/` (old location)
- [ ] Create new session, save chat
- [ ] Load skills, run a task
- [ ] Check logs in `~/.sage/logs/`

**Sandbox Tests** (with `SAGE_APP_DIR` set):

```bash
export SAGE_APP_DIR="$HOME/Library/Application Support/ai.sage.desktop"
export SAGE_DATA_DIR="$SAGE_APP_DIR/data"
export SAGE_CACHE_DIR="$SAGE_APP_DIR/cache"
cd src-api && npm run dev
```

Then run in separate terminal:
```bash
cd src-tauri && pnpm tauri dev
```

- [ ] App starts without errors
- [ ] Data created in `~/Library/Application Support/ai.sage.desktop/`
- [ ] Sidecar communicates on localhost:2026
- [ ] Old `~/.sage/` data migrates on first run
- [ ] Session persistence works
- [ ] File operations work
- [ ] Memory/logs update correctly
- [ ] Skills load from new location
- [ ] MCP config reads from new location

**Entitlements Sandbox Tests**:

```bash
# Build with sandbox entitlements
cd src-tauri
pnpm tauri build

# Check what entitlements are actually signed
codesign -d --entitlements - "target/.../Sage.app"

# Try to access home dir (should fail gracefully)
# Try to use shell commands (should fail)
```

---

## Rollback Strategy

If something breaks in sandbox mode:

1. **Revert entitlements**:
   ```xml
   <key>com.apple.security.app-sandbox</key>
   <false/>  <!-- Disable sandbox -->
   ```

2. **Revert path env vars** (not set by Tauri)

3. **Revert backend path logic** (just use `~/.sage/`)

4. **Keep the code changes** (they're backward compatible)

All changes are **fully backward compatible** with non-sandbox builds.

---

## Validation Checklist Before MAS Submission

- [ ] `entitlements.plist` has `com.apple.security.app-sandbox = true`
- [ ] No `kill_existing_api_process()` calls (or conditional on non-MAS)
- [ ] No `homedir()` access in sidecar (or behind `SAGE_APP_DIR` check)
- [ ] All data stored in `~/Library/Application Support/ai.sage.desktop/`
- [ ] `sage.db` is in app container
- [ ] `.env` only loaded from app container
- [ ] No `~/.claude/` access in sandbox mode
- [ ] Codesigned with MAS provisioning profile
- [ ] Notarized with `--secure-timestamp` flag
- [ ] App Store Connect submission passes validation

---

## Questions?

See `MAC_APP_STORE_ANALYSIS.md` for full technical breakdown.
