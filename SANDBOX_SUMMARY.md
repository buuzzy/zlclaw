# Mac App Store Sandbox Compatibility Summary

## Current Status: ❌ NOT COMPATIBLE

Sage's current architecture violates multiple Mac App Store sandbox requirements.

---

## Key Findings

### 1. Sidecar Mechanism ✓ COMPATIBLE
- **Current**: HTTP on localhost:2026
- **Issue**: None—sidecar architecture is fundamentally compatible with sandbox
- **Fix Needed**: Add sandbox entitlements to sidecar process

### 2. File System Access ❌ INCOMPATIBLE
- **Current**: Reads/writes to `~/.sage/`, `~/.claude/`, `~/`
- **Issue**: Sandbox only allows `~/Library/Containers/ai.sage.desktop/`
- **Fix**: Migrate all data to app container
- **Effort**: 2-3 days

### 3. Process Management ❌ INCOMPATIBLE
- **Current**: Uses `lsof` + `kill` to manage port 2026
- **Issue**: Sandboxed apps cannot execute external commands
- **Fix**: Implement health check or port retry logic
- **Effort**: 2-4 hours

### 4. Entitlements ❌ INCOMPLETE
- **Current**: Only JIT + unsigned code + hypervisor
- **Issue**: Missing sandbox declaration and file access rules
- **Fix**: Add `com.apple.security.app-sandbox = true` + specific file access
- **Effort**: 1-2 hours

### 5. Database Location ⚠️ NEEDS VERIFICATION
- **Current**: `sage.db` (path unclear in Tauri SQL plugin)
- **Issue**: May be in user home directory (not accessible in sandbox)
- **Fix**: Explicitly set to `~/Library/Application Support/ai.sage.desktop/data/sage.db`
- **Effort**: 1-2 hours

### 6. Claude Code Integration ❌ INCOMPATIBLE
- **Current**: Scans `~/.claude/skills/` and `~/.claude/settings.json`
- **Issue**: Cannot access other app's containers
- **Fix**: Disable in sandbox mode or use protocol-based discovery
- **Effort**: 2-4 hours

---

## Critical Issues (Must Fix)

1. **Move data from home to app container**
   - `~/.sage/` → `~/Library/Application Support/ai.sage.desktop/`
   - All subdirectories and config files

2. **Remove process killing logic**
   - Cannot use `lsof` or `kill` in sandbox
   - Implement health check or port retry instead

3. **Add app sandbox entitlement**
   - Set `com.apple.security.app-sandbox = true`
   - Add required file access entitlements

4. **Update backend paths**
   - Environment variables: `SAGE_APP_DIR`, `SAGE_DATA_DIR`, `SAGE_CACHE_DIR`
   - Fallback to `~/.sage/` for non-sandbox builds

5. **Disable home directory scanning**
   - Stop reading `~/.claude/` directories
   - Stop expanding `~/` paths

---

## What Works Unchanged

- ✓ Sidecar HTTP communication (localhost:2026)
- ✓ Frontend/backend separation
- ✓ Bundled resources (skills, defaults)
- ✓ SQLite database
- ✓ Session persistence (after path migration)
- ✓ Memory system (after path migration)
- ✓ Network features (HTTP, SSE)

---

## Implementation Timeline

| Phase | Task | Effort | Status |
|-------|------|--------|--------|
| 1 | Verify `sage.db` location | 30 min | 🔴 Not started |
| 2 | Feature-gate paths (constants.ts) | 1 hour | 🔴 Not started |
| 3 | Pass paths from Tauri → sidecar | 1 hour | 🔴 Not started |
| 4 | Remove home dir access | 1.5 hours | 🔴 Not started |
| 5 | Eliminate process killing | 1 hour | 🔴 Not started |
| 6 | Update entitlements | 1 hour | 🔴 Not started |
| 7 | Data migration logic | 2 hours | 🔴 Not started |
| 8 | Integration testing | 4+ hours | 🔴 Not started |
| **TOTAL** | | **~11 hours** | |

**Recommended**: Plan 2-3 day sprint for full implementation + testing

---

## Quick Start: Recommended Next Steps

### Option A: MAS Submission (Recommended Timing: After v1.1.0)

1. **Create feature branch**: `chore/mas-sandbox-support`
2. **Follow**: `MAS_IMPLEMENTATION_GUIDE.md` steps 1-10
3. **Test thoroughly** on both sandboxed and non-sandboxed configs
4. **Submit to App Store** with new entitlements
5. **Keep direct distribution** as fallback (non-MAS)

### Option B: Deferred to Later

1. Continue with current non-MAS distribution (notarized)
2. Plan MAS submission for next major version
3. Mark as technical debt in backlog

### Option C: Skip MAS Entirely

1. Use Tauri's auto-updater for distribution
2. Distribute directly (notarized + hosted on GitHub)
3. No sandbox compliance needed

---

## Affected Files (Complete List)

### Must Update
- `src-tauri/src/lib.rs` (sidecar launch, process killing)
- `src-api/src/config/constants.ts` (path functions)
- `src-tauri/entitlements.plist` (sandbox entitlements)
- `src-tauri/tauri.conf.json` (directory config)
- `src-api/src/shared/init/first-run.ts` (data location)

### Should Update
- `src-api/src/config/prompt-loader.ts` (verify path usage)
- `src-api/src/app/api/mcp.ts` (disable `.claude/` access)
- `src-api/src/app/api/files.ts` (disable home expansion)
- `src-api/src/app/api/providers.ts` (config paths)

### New Files
- `src-api/src/shared/init/migration.ts` (data migration)
- `scripts/sign-mas.sh` (MAS signing)

---

## Testing Requirements

Before MAS submission:

- [ ] **Cold start**: Fresh user with no existing data
- [ ] **Migration**: Existing `~/.sage/` data imports correctly
- [ ] **Data persistence**: Sessions, memory, config survive app restart
- [ ] **File operations**: Read/write skills, sessions, memory
- [ ] **Sidecar communication**: HTTP on localhost:2026 works
- [ ] **Entitlements**: Codesign verification shows sandbox enabled
- [ ] **Sandbox validation**: No access violations in system logs
- [ ] **App Store review**: Submission passes App Store requirements

---

## Non-Sandbox (Current) vs. Sandbox (MAS)

**Non-Sandbox** (current):
- Data: `~/.sage/`
- Process management: Kill port with `lsof`/`kill`
- Entitlements: JIT only
- Access: Full home directory, external commands
- Distribution: Notarized direct download
- Status: ✓ Working

**Sandbox** (MAS):
- Data: `~/Library/Application Support/ai.sage.desktop/`
- Process management: Health check + retry
- Entitlements: App sandbox + specific file access
- Access: App container + user-selected files
- Distribution: Mac App Store
- Status: ⚠️ Requires implementation

**Backward Compatibility**: Changes are fully backward compatible. Non-sandbox builds continue using `~/.sage/`.

---

## Documentation Reference

**See also**:
- `MAC_APP_STORE_ANALYSIS.md` — Full technical breakdown (563 lines)
- `MAS_IMPLEMENTATION_GUIDE.md` — Step-by-step implementation guide
- Tauri 2 docs: https://tauri.app
- Apple App Sandbox docs: https://developer.apple.com/library/archive/documentation/Security/Conceptual/AppSandboxDesignGuide/

---

## Questions?

**Q: Do we need to submit to MAS immediately?**
A: No. Current non-MAS distribution (notarized) works fine. Plan MAS submission for v1.1.0 or later.

**Q: Will sandbox mode break existing user data?**
A: No. Data automatically migrates from `~/.sage/` to app container on first launch with sandbox enabled.

**Q: Can we support both sandboxed and non-sandboxed builds?**
A: Yes. All changes are feature-gated via environment variables. Non-sandbox builds use `~/.sage/` as before.

**Q: What about users with existing `~/.sage/` data?**
A: Migration script copies all data automatically. No manual intervention needed.

**Q: Does this affect the sidecar architecture?**
A: No. Sidecar communication (HTTP on localhost:2026) is unchanged. Only data storage paths change.

---

## Status: Ready for Implementation

All analysis complete. Ready to proceed with implementation whenever team decides to pursue MAS distribution.
