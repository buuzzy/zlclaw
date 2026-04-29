# Mac App Store Sandbox Documentation Index

All analysis and implementation guides for Sage's Mac App Store (MAS) sandbox compatibility.

Generated: 2026-04-29

---

## 📋 Documents

### 1. **SANDBOX_SUMMARY.md** (Start here)
**Length**: ~200 lines  
**Audience**: Decision makers, project managers  
**Content**:
- Executive summary of sandbox incompatibility
- Key findings for each component
- Critical issues that must be fixed
- Implementation timeline (~11 hours)
- Quick decision matrix (Option A/B/C)

**When to read**: First—gives you the 5-minute overview.

---

### 2. **MAC_APP_STORE_ANALYSIS.md** (Deep dive)
**Length**: 563 lines  
**Audience**: Engineers implementing changes  
**Content**:
- Detailed architectural analysis
- Line-by-line code review
- Current vs. required configuration
- Phase-by-phase implementation plan
- Full checklist for MAS submission

**When to read**: Second—understand the full scope before coding.

---

### 3. **MAS_IMPLEMENTATION_GUIDE.md** (How-to guide)
**Length**: ~400 lines  
**Audience**: Developers implementing changes  
**Content**:
- Step-by-step instructions (Steps 1-10)
- Code snippets ready to use
- Testing procedures
- Rollback strategy
- Pre-submission validation checklist

**When to read**: Third—follow this when implementing.

---

## 🚀 Quick Decision Matrix

| Scenario | Action | Timeline | Effort |
|----------|--------|----------|--------|
| **Want MAS immediately** | Read SUMMARY, then GUIDE | Now | 2-3 days |
| **Want MAS eventually** | Read ANALYSIS, plan sprint | v1.1.0+ | Plan now |
| **Skip MAS** | Use direct distribution | N/A | Skip docs |
| **Not sure** | Read SUMMARY only | N/A | 5 min |

---

## 🔍 Key Issues Found

### ❌ Critical (Must Fix for MAS)
1. **File system access**: `~/.sage/` not accessible in sandbox
2. **Process management**: `lsof`/`kill` commands not allowed
3. **Home directory scanning**: Can't read `~/.claude/`
4. **Entitlements**: Missing sandbox declaration

### ⚠️ Important (Should Fix)
1. **Database location**: Verify `sage.db` is in app container
2. **Path passing**: Need to propagate app paths Tauri→backend
3. **Data migration**: Old `~/.sage/` needs automatic migration

### ✓ Compatible (No Changes Needed)
1. **Sidecar HTTP**: localhost:2026 communication is fine
2. **Network features**: SSE and HTTP work in sandbox
3. **Bundled resources**: Skills and defaults already in app

---

## 📊 Implementation Effort Breakdown

| Phase | Task | Time | Complexity |
|-------|------|------|-----------|
| 1 | Verify database location | 30 min | Easy |
| 2 | Feature-gate paths | 1 hour | Medium |
| 3 | Pass paths from Tauri | 1 hour | Medium |
| 4 | Remove home dir access | 1.5 hours | Medium |
| 5 | Eliminate process killing | 1 hour | Easy |
| 6 | Update entitlements | 1 hour | Easy |
| 7 | Data migration | 2 hours | Hard |
| 8 | Integration testing | 4+ hours | Hard |
| **TOTAL** | | **~11 hours** | |

**Recommendation**: Plan 2-3 day sprint (accounts for testing and debugging).

---

## 📁 Affected Files

### Must Modify (8 files)
```
src-tauri/src/lib.rs
src-tauri/entitlements.plist
src-tauri/tauri.conf.json
src-api/src/config/constants.ts
src-api/src/shared/init/first-run.ts
src-api/src/app/api/mcp.ts
src-api/src/app/api/files.ts
src-api/src/app/api/providers.ts
```

### Create New (2 files)
```
src-api/src/shared/init/migration.ts
scripts/sign-mas.sh
```

### Verify (2 files)
```
src-api/src/config/prompt-loader.ts
Tauri SQL plugin default path for sage.db
```

---

## 🎯 Before You Start

### Prerequisites
- [ ] macOS developer account (for App Store submission)
- [ ] Xcode 14+ with codesigning certificates
- [ ] Mac App Store App ID created in App Store Connect
- [ ] Provisioning profile with MAS capability

### Setup
1. Create feature branch: `chore/mas-sandbox-support`
2. Read `SANDBOX_SUMMARY.md` (5 min)
3. Read `MAC_APP_STORE_ANALYSIS.md` (30 min)
4. Review step 1 of `MAS_IMPLEMENTATION_GUIDE.md` (5 min)

---

## ✅ Execution Plan

### Week 1: Implementation
- Days 1-2: Refactor paths (Steps 2-4)
- Day 3: Eliminate process killing + update entitlements (Steps 5-6)
- Day 4: Data migration + testing (Steps 7-8)

### Week 2: Testing & Submission
- Days 1-2: Comprehensive testing (Step 10)
- Days 3-4: Codesigning and notarization
- Days 5+: App Store Connect submission

---

## 📖 Document Reference

### In SANDBOX_SUMMARY.md
- Current status overview
- Critical issues (6 items)
- Implementation timeline
- Backward compatibility notes
- FAQ

### In MAC_APP_STORE_ANALYSIS.md
- Detailed architecture analysis
- Specific line numbers and code
- Current vs. required configuration
- Full implementation checklist
- Tauri 2 documentation notes

### In MAS_IMPLEMENTATION_GUIDE.md
- 10 step-by-step guides
- Code snippets ready to copy-paste
- Testing procedures for each phase
- Rollback strategy if needed
- Pre-submission validation

---

## 🔧 Technology Stack

**Current**:
- Tauri 2.10.1
- Node.js sidecar (Hono framework)
- SQLite database
- macOS entitlements (JIT only)

**Targeted for MAS**:
- Tauri 2.10.1 (unchanged)
- Node.js sidecar with sandbox entitlements
- SQLite in app container
- macOS entitlements (sandbox + file access)

---

## 🚨 Common Pitfalls (Avoid These)

1. **Don't forget data migration**
   - Users with existing `~/.sage/` need auto-migration
   - See Step 8 in implementation guide

2. **Don't use hardcoded home paths**
   - All paths must be environment-variable based
   - Fallback to `~/.sage/` for non-sandbox

3. **Don't skip testing**
   - Test both sandbox and non-sandbox modes
   - Verify entitlements with `codesign -d`

4. **Don't change sidecar HTTP communication**
   - localhost:2026 works fine in sandbox
   - No changes needed to frontend/backend protocol

5. **Don't forget Claude Code integration**
   - Can't read `~/.claude/` in sandbox
   - Must disable or use protocol-based discovery

---

## 📞 Questions & Answers

**Q: Can we keep both MAS and non-MAS builds?**
A: Yes! Changes are fully backward compatible. Environment variables control behavior.

**Q: What if database is in wrong location?**
A: Step 1 of implementation guide verifies and fixes this.

**Q: Do we need to submit immediately?**
A: No. MAS is optional. Current non-MAS distribution works fine.

**Q: Will users lose data?**
A: No. Automatic migration script moves `~/.sage/` to app container.

**Q: How long until we can submit?**
A: ~11 hours of implementation + 2-3 days for testing = ~1 week.

---

## 📚 External References

- [Tauri 2 Documentation](https://tauri.app)
- [Apple App Sandbox Design Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/AppSandboxDesignGuide/)
- [Mac App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Xcode Code Signing Guide](https://help.apple.com/xcode/mac/current/#/dev3a05256b8)

---

## 📝 Document Metadata

- **Created**: 2026-04-29
- **Analysis Type**: Complete architectural review
- **Current Version**: Sage v1.0.5
- **Status**: ✅ Ready for implementation
- **Maintainer**: Nako
- **Last Updated**: 2026-04-29

---

## Navigation

**Start with**: `SANDBOX_SUMMARY.md`  
**Then read**: `MAC_APP_STORE_ANALYSIS.md`  
**Implement with**: `MAS_IMPLEMENTATION_GUIDE.md`

---

**All three documents saved to project root.**
