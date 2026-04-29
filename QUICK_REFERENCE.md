# Sage Mac App Store Sandbox: Quick Reference

**Current Status**: ❌ NOT COMPATIBLE (but fixable)

---

## TL;DR

Sage **cannot be submitted to Mac App Store** without these changes:
1. Move data from `~/.sage/` to `~/Library/Application Support/ai.sage.desktop/`
2. Remove `lsof`/`kill` process management
3. Update entitlements to enable sandbox
4. Disable `~/.claude/` directory access
5. Implement automatic data migration

**Effort**: ~11 hours dev + 2-3 days testing = **~1 week**

---

## What Breaks in Sandbox?

| Component | Issue | Fix |
|-----------|-------|-----|
| `~/.sage/` storage | Cannot access home dir | Move to app container |
| Process killing | Cannot use `lsof`/`kill` | Health check + retry |
| Entitlements | Missing sandbox flag | Add `app-sandbox = true` |
| `~/.claude/` access | Cannot read other apps | Conditional disable |
| `.env` file | Must be in app container | Load from container only |

---

## Key Files to Modify

**Tauri (Frontend)**:
- `src-tauri/src/lib.rs` - Remove port killing, pass paths
- `src-tauri/entitlements.plist` - Add sandbox profile
- `src-tauri/tauri.conf.json` - Configure directories

**Backend (Node.js)**:
- `src-api/src/config/constants.ts` - Environment variable paths
- `src-api/src/app/api/mcp.ts` - Disable `.claude/` access
- `src-api/src/app/api/files.ts` - Disable home expansion

**New Files**:
- `src-api/src/shared/init/migration.ts` - Migrate old data
- `scripts/sign-mas.sh` - MAS signing script

---

## Implementation Checklist

- [ ] Step 1: Verify `sage.db` location (30 min)
- [ ] Step 2: Feature-gate paths (1 hour)
- [ ] Step 3: Pass paths from Tauri (1 hour)
- [ ] Step 4: Remove home dir access (1.5 hours)
- [ ] Step 5: Eliminate process killing (1 hour)
- [ ] Step 6: Update entitlements (1 hour)
- [ ] Step 7: Data migration (2 hours)
- [ ] Step 8: Integration testing (4+ hours)

---

## Environment Variables

**Tauri passes to sidecar**:
```bash
SAGE_APP_DIR=/Users/nako/Library/Application Support/ai.sage.desktop
SAGE_DATA_DIR=/Users/nako/Library/Application Support/ai.sage.desktop/data
SAGE_CACHE_DIR=/Users/nako/Library/Application Support/ai.sage.desktop/cache
```

**Backend checks**:
```typescript
if (process.env.SAGE_APP_DIR) {
  // Running in sandbox (MAS)
} else {
  // Running non-sandbox (use ~/.sage/)
}
```

---

## Data Migration

**Automatic on first sandbox launch**:
- `~/.sage/skills/` → `~/Library/.../data/skills/`
- `~/.sage/sessions/` → `~/Library/.../data/sessions/`
- `~/.sage/memory/` → `~/Library/.../data/memory/`
- `~/.sage/SOUL.md` → `~/Library/.../SOUL.md`
- All config files preserved

---

## Testing Quick Start

**Non-Sandbox** (ensure no regression):
```bash
pnpm tauri dev
# Data should be in ~/.sage/
```

**Sandbox** (manual):
```bash
export SAGE_APP_DIR="$HOME/Library/Application Support/ai.sage.desktop"
export SAGE_DATA_DIR="$SAGE_APP_DIR/data"
export SAGE_CACHE_DIR="$SAGE_APP_DIR/cache"
pnpm tauri dev
# Data should be in ~/Library/Application Support/
```

---

## Critical Don'ts

❌ Don't use hardcoded paths  
❌ Don't forget data migration  
❌ Don't change HTTP communication (localhost:2026 is fine)  
❌ Don't remove fallback to `~/.sage/` for non-sandbox  
❌ Don't skip testing both modes  

---

## Decision Matrix

**If you want MAS now**:
→ Follow `MAS_IMPLEMENTATION_GUIDE.md`

**If you want MAS later**:
→ Read `MAC_APP_STORE_ANALYSIS.md`, plan for v1.1.0

**If you're skipping MAS**:
→ Keep current distribution (notarized direct)

---

## File Locations Reference

**Non-Sandbox** (current):
```
~/.sage/
├── skills/
├── sessions/
├── memory/
├── SOUL.md
├── mcp.json
└── ...
```

**Sandbox** (MAS):
```
~/Library/Application Support/ai.sage.desktop/
├── config/
│   └── .env
├── data/
│   ├── skills/
│   ├── sessions/
│   ├── memory/
│   └── sage.db
├── cache/
├── logs/
├── SOUL.md
├── mcp.json
└── ...
```

---

## Entitlements Change

**Before** (current):
```xml
<key>com.apple.security.cs.allow-jit</key>
<true/>
<!-- JIT only - cannot submit to MAS -->
```

**After** (MAS-compatible):
```xml
<key>com.apple.security.app-sandbox</key>
<true/>  <!-- Enable sandbox -->

<key>com.apple.security.network.client</key>
<true/>  <!-- Allow localhost:2026 -->

<key>com.apple.security.cs.allow-jit</key>
<true/>  <!-- Still needed for Node.js -->

<!-- File access for app container (automatic in sandbox) -->
<key>com.apple.security.files.user-selected.read-write</key>
<true/>  <!-- Allow file dialogs -->
```

---

## Key Code Changes

**constants.ts**:
```typescript
export function getAppDir(): string {
  return process.env.SAGE_APP_DIR || join(homedir(), '.sage');
}
```

**lib.rs**:
```rust
let app_dir = app.path().app_config_dir().ok()?;
sidecar_command = sidecar_command
    .env("SAGE_APP_DIR", app_dir.to_string_lossy().to_string());
```

---

## Documentation Quick Links

| Document | Length | Best For | Time |
|----------|--------|----------|------|
| `SANDBOX_DOCS_INDEX.md` | 272 lines | Navigation | 5 min |
| `SANDBOX_SUMMARY.md` | 215 lines | Executives | 5 min |
| `MAC_APP_STORE_ANALYSIS.md` | 563 lines | Engineers | 30 min |
| `MAS_IMPLEMENTATION_GUIDE.md` | 651 lines | Developers | 2-3 hours |

---

## Success Criteria

Before MAS submission, verify:
- [ ] All data in app container (not `~/.sage/`)
- [ ] Entitlements have `app-sandbox = true`
- [ ] No `lsof`/`kill` command usage
- [ ] No home directory access (or conditional)
- [ ] `sage.db` in app container
- [ ] Codesign verification passes
- [ ] Tests pass on sandboxed app

---

## Questions?

**Q: When should we do this?**
A: Recommend after v1.1.0 (not urgent—current non-MAS works)

**Q: Will users lose data?**
A: No—automatic migration script included

**Q: Can we keep non-MAS builds?**
A: Yes—all changes are backward compatible

**Q: How much effort?**
A: ~11 hours code + 2-3 days testing

---

**For details, see**: 
- `SANDBOX_DOCS_INDEX.md` (navigation)
- `MAS_IMPLEMENTATION_GUIDE.md` (how-to)
