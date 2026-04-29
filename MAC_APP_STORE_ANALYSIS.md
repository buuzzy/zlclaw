# Sage Tauri 2 App: Mac App Store Sandboxing Analysis

## Executive Summary

Sage's current architecture is **incompatible with Mac App Store's App Sandbox** in multiple critical areas:

1. **Unrestricted home directory access** (`~/.sage/`, `~/.claude/`, `~/.env`)
2. **Sidecar running unrestricted** (no sandbox entitlements)
3. **Direct process launching** (killing existing processes via lsof/kill commands)
4. **Uncontrolled database location** (likely in unsandboxed location)
5. **Minimal entitlements** (only allows JIT, unsigned code execution, hypervisor)

---

## 1. SIDECAR MECHANISM (`src-tauri/src/lib.rs`)

### Current Implementation

#### Sidecar Launch (Lines 241-276)
```rust
// Production mode only (not debug)
#[cfg(not(debug_assertions))]
{
    const API_PORT: u16 = 2026;
    
    // Kill any existing process on the API port
    kill_existing_api_process(API_PORT);
    
    // Load .env from multiple locations:
    // 1. app.path().app_config_dir()/.env  (Tauri sandbox config)
    // 2. ~/\.sage\.env                      (Home dir - SANDBOX VIOLATES)
    // 3. ~/.env                             (Home dir - SANDBOX VIOLATES)
    
    let mut sidecar_command = app.shell().sidecar("sage-api")
        .unwrap()
        .env("PORT", "2026")
        .env("NODE_ENV", "production");
    
    // Spawns sidecar and logs output
    let (mut rx, child) = sidecar_command.spawn()?;
}
```

#### Problems for Mac App Store

1. **Kills existing processes** (lines 51-96)
   - Uses `lsof` command on Unix (macOS/Linux)
   - Uses `kill -9` to terminate processes
   - **Mac App Store Issue**: Sandboxed apps cannot:
     - Execute arbitrary system commands (`lsof`, `kill`)
     - Kill processes outside their sandbox

2. **Home directory access** (lines 255-262)
   - `dirs::home_dir().map(|p| p.join(".sage").join(".env"))` → `~/.sage/.env`
   - `dirs::home_dir().map(|p| p.join(".env"))` → `~/.env`
   - **Mac App Store Issue**: Sandbox only allows `~/Library/Containers/ai.sage.desktop/` access

3. **Sidecar spawned unrestricted**
   - Sidecar inherits all parent environment variables
   - No sandbox profile for sidecar process
   - **Mac App Store Issue**: Sidecar has unrestricted file/network access

### Communication Method

- **HTTP on localhost:2026** ✓ This is sandbox-compatible
- Frontend sends HTTP requests → Sidecar responds
- No IPC or socket restrictions

---

## 2. TAURI CONFIG (`src-tauri/tauri.conf.json`)

### Current Bundle Configuration

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["../src-api/dist/sage-api"],  // Sidecar binary
    "macOS": {
      "entitlements": "entitlements.plist"
    },
    "resources": {
      "../src-api/resources": "resources"  // Bundled skills, defaults
    }
  }
}
```

### Issues

1. **No Mac App Store specific configuration**
   - No `sandboxProfile` or `sandboxRules` in tauri.conf.json
   - Tauri 2 does not have built-in App Sandbox configuration

2. **Sidecar bundled but not sandboxed**
   - `externalBin` includes the Node.js sidecar
   - No way to specify sandbox entitlements for sidecar in current config

3. **Resources bundled in app but paths may be absolute**
   - `../src-api/resources` includes skills and defaults
   - App tries to read from `process.cwd()` or relative paths

---

## 3. ENTITLEMENTS (`src-tauri/entitlements.plist`)

### Current Entitlements

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <!-- Allow JIT compilation for Node.js/V8 -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    
    <!-- Allow unsigned executable memory -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    
    <!-- Disable library validation -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    
    <!-- Allow Hypervisor.framework for VM sandboxing -->
    <key>com.apple.security.hypervisor</key>
    <true/>
    
    <!-- Allow Virtualization.framework -->
    <key>com.apple.security.virtualization</key>
    <true/>
</dict>
</plist>
```

### Critical Missing Entitlements for Mac App Store Sandbox

1. **Missing home directory entitlements**
   - No `com.apple.security.files.user-selected.read-write`
   - No `com.apple.security.files.home-relative-path.read-write`

2. **Missing required sandbox entitlements**
   - No `com.apple.security.app-sandbox` ← **REQUIRED for MAS**
   - No file container access rules

3. **Hypervisor/Virtualization entitlements**
   - `hypervisor` and `virtualization` are **NOT available in MAS builds**
   - Only usable for notarized but not sandboxed apps

4. **Mac App Store specific issues**
   - To enable sandboxing, need to add:
     ```xml
     <key>com.apple.security.app-sandbox</key>
     <true/>
     ```
   - But then ALL other entitlements must be explicitly allowed

---

## 4. FILE SYSTEM ACCESS IN BACKEND

### ~/.sage/ Directory Structure (First-Run Init)

**File**: `src-api/src/shared/init/first-run.ts` (lines 65-73)

Creates:
```
~/.sage/
├── skills/           (User skills)
├── sessions/         (Chat sessions)
├── memory/           (Daily memory files)
├── logs/             (App logs)
├── cache/            (Cache data)
├── cron/             (Scheduled jobs)
├── SOUL.md           (System personality)
├── AGENTS.md         (Agent definitions)
├── MEMORY.md         (Long-term memory)
├── mcp.json          (MCP server config)
└── user.md           (User profile)
```

### Access Patterns in Backend

**File**: `src-api/src/config/constants.ts`

```typescript
export function getAppDir(): string {
  return join(homedir(), APP_DIR_NAME);  // homedir() + ".sage"
}

export function getWorkanySkillsDir(): string {
  return join(getAppDir(), SKILLS_DIR_NAME);  // ~/.sage/skills
}

export function getClaudeSkillsDir(): string {
  return join(getClaudeDir(), SKILLS_DIR_NAME);  // ~/.claude/skills
}

export function getAllSkillsDirs(): { name: string; path: string }[] {
  return [
    { name: 'sage', path: getWorkanySkillsDir() },
    { name: 'claude', path: getClaudeSkillsDir() },  // READS ~/.claude/
  ];
}

export function getClaudeSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json');  // ~/.claude/settings.json
}
```

### Specific File Read/Write Operations

**Files API** (`src-api/src/app/api/files.ts`)
- Enumerates and reads files from `~/.sage/` and `~/.claude/`
- Expands `~/` paths to full home directory
- **Problem**: No sandbox container checks

**MCP Config API** (`src-api/src/app/api/mcp.ts`)
- Reads/writes `~/.sage/mcp.json`
- Reads `~/.claude/settings.json` (Claude Code config)
- Creates directories with `fs.mkdir()`

**Feishu/WeChat Config** (`src-api/src/app/api/feishu.ts`, `wechat.ts`)
- Writes config to `~/.sage/` directory
- Uses `readFileSync`, `writeFileSync`

**Prompt Loader** (`src-api/src/config/prompt-loader.ts`)
- Loads `SOUL.md`, `AGENTS.md` from `~/.sage/`
- Reads daily memory from `~/.sage/memory/YYYY-MM-DD.md`
- Reads `user.md` from `~/.sage/`

### Cross-Home-Dir Access

```typescript
// Reads both Sage AND Claude directories
export function getAllMcpConfigPaths(): { name: string; path: string }[] {
  return [
    { name: 'sage', path: getWorkanyMcpConfigPath() },      // ~/.sage/mcp.json
    { name: 'claude', path: getClaudeSettingsPath() },       // ~/.claude/settings.json
  ];
}
```

**Mac App Store Issue**: Cannot access `~/.claude/` in sandbox.

---

## 5. DATABASE LOCATION

### SQLite Database

**File**: `src-tauri/src/lib.rs` (line 225)

```rust
.add_migrations("sqlite:sage.db", migrations)
```

**Problem**: The `sage.db` path is NOT explicitly set!
- Tauri SQL plugin defaults to `~/.data/` or app config directory
- Need to verify actual location (likely `~/Library/Application Support/ai.sage.desktop/sage.db`)

**Sandbox Impact**:
- If in user home: ❌ Not accessible in sandbox
- If in app container: ✓ Accessible (need explicit path)

---

## 6. CURRENT PROBLEMS FOR MAC APP STORE COMPLIANCE

### Critical Blockers

| Issue | Current | MAS Requirement | Impact |
|-------|---------|-----------------|--------|
| Process killing | `kill` command on port 2026 | Cannot use external commands | **Must change** |
| Home dir access | `~/.sage/`, `~/.claude/` | Only `~/Library/Containers/{ID}/` | **Must change** |
| Database path | `sage.db` (unclear) | Must use app container | **Must verify** |
| Sidecar sandbox | None | Must have profile | **Must add** |
| Entitlements | Hypervisor only | Sandbox + specific file access | **Must update** |
| System APIs | `lsof`, `kill` | Shell plugin disabled in sandbox | **Must eliminate** |

### Secondary Issues

- `.env` file loading from home directory (can't access `~/.sage/.env`)
- Cross-directory access to `~/.claude/` (Claude Code config)
- No containerized paths for resources
- App behavior differs from non-sandboxed version

---

## 7. REQUIRED CHANGES FOR MAC APP STORE DISTRIBUTION

### Phase 1: Architecture Changes (Required)

#### 1.1 Move Data to App Container
**Change**: Use Tauri's app paths instead of home directory

```rust
// BEFORE (non-sandbox compatible)
dirs::home_dir().map(|p| p.join(".sage").join(".env"))

// AFTER (sandbox compatible)
app.path().app_config_dir().ok().map(|p| p.join(".env"))
```

**Affected Files**:
- `src-tauri/src/lib.rs` (lines 255-262)
- `src-api/src/config/constants.ts` (all path functions)
- `src-api/src/shared/init/first-run.ts` (install location)

**New Structure**:
```
~/Library/Application Support/ai.sage.desktop/
├── config/
│   ├── .env
│   └── config.json
├── cache/
├── data/
│   ├── sage.db
│   ├── skills/
│   ├── sessions/
│   ├── memory/
│   └── ...
└── logs/
```

#### 1.2 Eliminate Process Killing
**Current**: Lines 51-96 in `src-tauri/src/lib.rs`

**Solution**: 
- Port 2026 should be reserved for sidecar
- If sidecar already running, reuse existing connection
- Or: Stop sidecar gracefully on app exit (already done)

#### 1.3 Port Conflict Resolution
**Before eliminating kill logic**:
- Implement sidecar health check
- If port taken, try alternate ports (2027, 2028, etc.)
- Or: Implement proper sidecar process state file

#### 1.4 Remove Home Directory .env Loading
**Current**: Lines 255-262 try multiple .env locations

**Solution**:
- Only load `.env` from app config directory: `~/Library/Application Support/ai.sage.desktop/.env`
- Or: Use environment variables passed by launcher

### Phase 2: Backend Path Changes (Required)

#### 2.1 Update Tauri Backend Paths
**File**: `src-api/src/config/constants.ts`

```typescript
// BEFORE
export function getAppDir(): string {
  return join(homedir(), APP_DIR_NAME);  // ~/.sage
}

// AFTER
export function getAppDir(): string {
  // Will be passed from Tauri or from app startup
  // Fallback to homedir().sage for non-MAS builds
  return process.env.SAGE_APP_DIR || join(homedir(), APP_DIR_NAME);
}
```

#### 2.2 Pass App Dir from Tauri to Sidecar
**File**: `src-tauri/src/lib.rs`

```rust
// After getting app config dir
let app_dir = app.path().app_config_dir().ok()?;

// Pass to sidecar
let mut sidecar_command = app.shell().sidecar("sage-api")
    .unwrap()
    .env("PORT", "2026")
    .env("NODE_ENV", "production")
    .env("SAGE_APP_DIR", app_dir.to_string_lossy().to_string())  // NEW
    .env("SAGE_DATA_DIR", app_dir.join("data").to_string_lossy().to_string());  // NEW
```

### Phase 3: Entitlements & Bundling (Required)

#### 3.1 New Entitlements for Sandbox
**File**: `src-tauri/entitlements.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" 
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- REQUIRED: Enable App Sandbox -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    
    <!-- Network: localhost only for sidecar -->
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    
    <!-- JIT for Node.js sidecar -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    
    <!-- Disable library validation for Node.js -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    
    <!-- File system: only app container + user-selected documents -->
    <key>com.apple.security.files.downloads-folder-level</key>
    <string>read-write</string>
    
    <!-- Allow reading user-selected files (Open dialog) -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

#### 3.2 Database Location in Config
**File**: `src-tauri/tauri.conf.json`

```json
{
  "app": {
    "directories": {
      "dataDir": "data",
      "cacheDir": "cache"
    }
  }
}
```

**Then in backend**:
```rust
let db_path = app.path().app_data_dir().ok()?.join("sage.db");
// Pass to backend or use in Tauri SQL plugin
```

### Phase 4: Handle Claude Code Integration

#### 4.1 Remove Direct ~/.claude/ Access

**Current Issue**: 
- `src-api/src/config/constants.ts` reads `~/.claude/skills/` and `~/.claude/settings.json`
- Impossible in sandbox

**Solution A (MAS Only)**:
```typescript
export function getAllSkillsDirs(): { name: string; path: string }[] {
  #[cfg(target_os = "macos")]
  let dirs = [{ name: 'sage', path: getWorkanySkillsDir() }];
  
  #[cfg(not(target_os = "macos"))]
  let dirs = [
    { name: 'sage', path: getWorkanySkillsDir() },
    { name: 'claude', path: getClaudeSkillsDir() },
  ];
  
  return dirs;
}
```

**Solution B (Better)**:
- Claude Code registers skills via IPC/URL scheme (already supported: `sage://` scheme)
- MCP servers discovered via standard protocol, not filesystem scan

#### 4.2 .env File Handling

**Current**: Loads from home directory
**Solution**: Store in app container, warn on first run

---

## 8. IMPLEMENTATION CHECKLIST

### Phase 1: Sidecar & Process Management
- [ ] Remove `kill_existing_api_process()` function
- [ ] Implement sidecar health check + port retry logic
- [ ] Update sidecar spawn to pass `SAGE_APP_DIR` env var
- [ ] Test sidecar graceful restart

### Phase 2: Path Migration
- [ ] Create feature flag `target_os = "macos"` for conditional paths
- [ ] Update `constants.ts` to use `SAGE_APP_DIR` env var
- [ ] Update all file APIs to respect new paths
- [ ] Migrate first-run init to new location
- [ ] Handle data migration for existing users

### Phase 3: Database
- [ ] Verify sage.db location (add logging)
- [ ] Move to `~/Library/Application Support/ai.sage.desktop/data/sage.db`
- [ ] Update Tauri SQL migrations path

### Phase 4: Entitlements & Building
- [ ] Update `entitlements.plist` with sandbox profile
- [ ] Remove hypervisor/virtualization entitlements (for MAS)
- [ ] Test codesigning and notarization

### Phase 5: Integration Tests
- [ ] Test cold start on fresh macOS user
- [ ] Test with existing `~/.sage/` data (no migration)
- [ ] Test file operations (read/write skills, memory)
- [ ] Test sidecar communication
- [ ] Test App Store submission

---

## 9. TAURI 2 MAC APP STORE DOCUMENTATION

**Note**: Tauri 2 doesn't have built-in MAS sandbox support. You must:

1. Use standard Tauri bundle for non-MAS
2. Create custom build script for MAS:
   - Add `com.apple.security.app-sandbox = true` to entitlements
   - Use provisioning profile with MAS capability
   - Use `productsign` instead of `codesign` for MAS builds

3. Alternative: Use Tauri's updater + direct distribution (not MAS)

**Reference**: Tauri docs recommend non-MAS for dev tools, but MAS is possible with constraints.

---

## 10. SUMMARY OF CHANGES NEEDED

### For Non-Sandboxed (Current Distribution)
- ✓ No changes required (works as-is)

### For Sandboxed (macOS App Store)
| Component | Current | After Sandbox |
|-----------|---------|--------------|
| Data dir | `~/.sage/` | `~/Library/Application Support/ai.sage.desktop/` |
| Process mgmt | Kill port 2026 | Health check + retry |
| Home access | Direct | None |
| Claude Code | Read `~/.claude/` | Fallback only (no cross-app access) |
| Entitlements | JIT only | Add sandbox profile |
| Database | `sage.db` (unclear) | `~/Library/.../data/sage.db` |
| Build process | `tauri build` | Custom MAS provisioning + `productsign` |

### Effort Estimate
- Phase 1-3: **2-3 days** (path migration, testing)
- Phase 4: **1 day** (entitlements, codesigning)
- Phase 5: **1-2 days** (integration tests, MAS submission)
- **Total**: ~1 week for full MAS compliance

---

## Recommendation

**For immediate release**: Continue with current non-MAS distribution (notarized via `codesign`).

**For MAS submission**: Plan dedicated sprint (1-2 weeks) to:
1. Refactor paths to app container
2. Eliminate system command usage (lsof, kill)
3. Update entitlements and build process
4. Test thoroughly on sandboxed environment

The sidecar architecture is fundamentally compatible with MAS—only data access patterns need updating.
