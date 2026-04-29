# Sandbox Testing and Verification Procedures

## Overview

This document provides comprehensive testing procedures for verifying that Sage operates correctly in macOS App Store sandbox environment.

## Test Categories

### 1. Sandbox Detection Tests

**Objective:** Verify that sandbox environment is correctly detected

#### Test 1.1: Detect MAS Sandbox
```bash
# When running in MAS sandbox, the app should detect it
curl http://localhost:2026/health -H "Accept: application/json" | jq '.sandbox'
# Expected: { "detected": true, "type": "mas" }
```

#### Test 1.2: App Directory Resolution
```bash
# Verify app directory is set to container path
curl http://localhost:2026/api/debug/paths | jq '.appDir'
# Expected: /var/folders/.../Library/Containers/ai.sage.desktop/Data
# NOT: /Users/username/.sage
```

#### Test 1.3: Sandbox Status on Startup
```bash
# Check server logs for sandbox detection message
# Expected log: "[Init] Running in sandbox environment"
# Expected log: "[Init] App directory: /var/folders/.../Library/Containers/..."
```

---

### 2. Path Handling Tests

**Objective:** Verify paths work correctly in sandbox

#### Test 2.1: Configuration Files Accessible
```bash
# Create a test config
curl -X POST http://localhost:2026/config \
  -H "Content-Type: application/json" \
  -d '{"test": "value"}'

# Read it back
curl http://localhost:2026/config | jq '.data'
# Expected: { "test": "value" }
```

#### Test 2.2: Skills Directory Access
```bash
# Verify skills directory exists and is accessible
curl http://localhost:2026/files/skills-dir | jq '.exists'
# Expected: true
```

#### Test 2.3: Session Files Created
```bash
# Create a session and verify it's written to container
# Check logs for: "[Init] Created directory: {appDir}/sessions"
```

---

### 3. File System Access Tests

**Objective:** Verify file operations work and are restricted appropriately

#### Test 3.1: Within Container - Permitted
```bash
# Reading files from app directory should work
curl -X POST http://localhost:2026/files/read-binary \
  -H "Content-Type: application/json" \
  -d '{"path": "<appDir>/config.json"}'
# Expected: Success with file content
```

#### Test 3.2: Outside Container - Denied
```bash
# Attempt to read system file should fail
curl -X POST http://localhost:2026/files/read-binary \
  -H "Content-Type: application/json" \
  -d '{"path": "/etc/passwd"}'
# Expected: { "error": "Access denied - path outside app sandbox" }, status 403
```

#### Test 3.3: Claude Code Inaccessible
```bash
# Verify Claude Code config is not accessible
curl http://localhost:2026/mcp/all-configs | jq '.configs[] | select(.name=="claude")'
# Expected: { "name": "claude", "exists": false, "sandboxRestricted": true }
```

---

### 4. Data Access Tests

**Objective:** Verify data is correctly stored and accessed

#### Test 4.1: Memory Database Access
```bash
# Store memory data
curl -X POST http://localhost:2026/memory/store \
  -H "Content-Type: application/json" \
  -d '{"key": "test", "value": "data"}'

# Retrieve it
curl http://localhost:2026/memory/retrieve?key=test | jq '.value'
# Expected: "data"

# Verify file is in app container, not in home
# File should be at: {appDir}/memory/test.json
```

#### Test 4.2: Session State Persistence
```bash
# Create and save session
curl -X POST http://localhost:2026/agent/session \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'

# Restart app and verify session can be retrieved
# Check logs for: "[Init] App directory initialized: {appDir}"
```

---

### 5. Network Tests

**Objective:** Verify network access works for required operations

#### Test 5.1: Localhost Connections
```bash
# Frontend to API communication should work
curl http://localhost:2026/health
# Expected: 200 OK with health status
```

#### Test 5.2: External Service Calls (if configured)
```bash
# External API calls through Sage should work (if entitlements allow)
# This depends on your entitlements configuration
```

---

### 6. Sidecar Process Tests

**Objective:** Verify API sidecar starts and operates correctly

#### Test 6.1: Sidecar Spawning
```bash
# Check Tauri logs for sidecar startup
# Expected: "[API] Running in sandbox environment"
# Expected: "[API] App data directory: {appDir}"
```

#### Test 6.2: Environment Variable Injection
```bash
# Verify SAGE_APP_DIR was passed to sidecar
# Check logs for: "[API] Injected env: SAGE_APP_DIR"
```

#### Test 6.3: Port Binding
```bash
# Verify API is listening on correct port
lsof -i :2026
# Expected: sage-api (or node process) listening on 0.0.0.0:2026 or 127.0.0.1:2026
```

---

### 7. Migration Tests

**Objective:** Verify data migration from standard location to sandbox

#### Test 7.1: Pre-Existing Data Migration
```bash
# Simulate old data in ~/.sage directory
mkdir -p ~/.sage/skills
echo '{"test": "config"}' > ~/.sage/config.json

# Install MAS version and launch
# Expected: "[SandboxMigration] Migrating from: ~/.sage"
# Expected: "[SandboxMigration] ✓ Migration complete: X items copied"
# Verify data now exists in container: {appDir}/.sage/config.json
```

#### Test 7.2: Migration Marker
```bash
# After first launch, check for migration marker
ls -la {appDir}/.sage/.migration-complete
# Expected: File exists with timestamp and migration details
```

#### Test 7.3: Skip Re-Migration
```bash
# Restart app
# Expected: "[SandboxMigration] Migration marker found, skipping"
# No items should be copied twice
```

---

### 8. Entitlements Tests

**Objective:** Verify entitlements are correctly configured

#### Test 8.1: App Sandbox Enabled
```bash
# Check entitlements in built app
codesign -d --entitlements :- /path/to/Sage.app | \
  grep -A 1 "com.apple.security.app-sandbox"
# Expected: <key>com.apple.security.app-sandbox</key> <true/>
```

#### Test 8.2: Network Entitlements
```bash
codesign -d --entitlements :- /path/to/Sage.app | \
  grep -E "com.apple.security.network\.(client|server)"
# Expected: Both client and server network entitlements present
```

#### Test 8.3: Code Signing Entitlements
```bash
codesign -d --entitlements :- /path/to/Sage.app | \
  grep -E "com.apple.security.cs\.(allow-jit|allow-unsigned)"
# Expected: JIT and unsigned memory entitlements present (for Node.js)
```

---

### 9. MAS Compliance Tests

**Objective:** Verify MAS-specific compliance

#### Test 9.1: No Hypervisor Entitlement
```bash
codesign -d --entitlements :- /path/to/Sage.app | \
  grep "com.apple.security.hypervisor"
# Expected: NOT FOUND (should fail with no match)
```

#### Test 9.2: No Virtualization Entitlement
```bash
codesign -d --entitlements :- /path/to/Sage.app | \
  grep "com.apple.security.virtualization"
# Expected: NOT FOUND (should fail with no match)
```

#### Test 9.3: API Communication
```bash
# Verify API works through Tauri IPC
# Frontend should successfully call backend through sidecar
curl http://localhost:2026/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'
# Expected: 200 OK with agent response
```

---

## Automated Testing Script

Create a test script to run all tests:

```bash
#!/bin/bash
# test-sandbox.sh

API_PORT=2026
API_URL="http://localhost:$API_PORT"

echo "=== Sandbox Testing Suite ==="
echo ""

# Test 1: Health check
echo "Test 1: Health Check"
curl -s $API_URL/health | jq . || echo "FAILED"

# Test 2: Sandbox detection
echo "Test 2: Sandbox Detection"
curl -s $API_URL/health | jq '.sandbox' || echo "FAILED"

# Test 3: Skills directory
echo "Test 3: Skills Directory Access"
curl -s $API_URL/files/skills-dir | jq '.exists' || echo "FAILED"

# Test 4: MCP configs (Claude should be restricted)
echo "Test 4: MCP Config Access"
curl -s $API_URL/mcp/all-configs | jq '.configs | map(select(.name=="claude"))' || echo "FAILED"

# Test 5: Entitlements check
echo "Test 5: App Sandbox Entitlement"
codesign -d --entitlements :- /Applications/Sage.app 2>/dev/null | \
  grep -q "com.apple.security.app-sandbox" && echo "PRESENT" || echo "MISSING"

echo ""
echo "=== Tests Complete ==="
```

---

## Manual Testing Checklist

- [ ] App launches successfully in sandbox
- [ ] "[Init] Running in sandbox environment" appears in logs
- [ ] Config files are readable/writable
- [ ] Skills directory is accessible
- [ ] Session files are created in app directory
- [ ] Cannot access files outside app container
- [ ] Claude Code config is not accessed
- [ ] API server responds to requests
- [ ] Sidecar process receives SAGE_APP_DIR env var
- [ ] Old ~/.sage data migrates to container on first launch
- [ ] App doesn't re-migrate data on subsequent launches
- [ ] Entitlements include app-sandbox
- [ ] Entitlements exclude hypervisor/virtualization
- [ ] Network requests work (localhost)

---

## Debugging

### Enable Verbose Logging
```bash
RUST_LOG=debug cargo tauri dev
```

### Check Container Path
```bash
# Verify you're in sandbox
echo $HOME
# Should show: /var/folders/.../Library/Containers/ai.sage.desktop/Data
```

### View Sidecar Logs
```bash
# Tauri logs show sidecar output
# Look for: [API] messages in console
```

### Inspect Entitlements
```bash
# Check what entitlements are in use
codesign -d --entitlements :- /path/to/app
```

---

## Common Issues and Solutions

### Issue: "Access denied" when reading files
**Cause:** Path is outside sandbox container
**Solution:** Verify path is within $HOME (which is already the container)

### Issue: Claude Code config not loading
**Cause:** Intentionally restricted in sandbox
**Solution:** This is expected behavior - Claude Code is not accessible in MAS

### Issue: Data not migrating from ~/.sage
**Cause:** Old ~/.sage is outside sandbox container
**Solution:** Verify migration ran, check logs for "[SandboxMigration]" messages

### Issue: "Port already in use" error
**Cause:** Previous sidecar still running
**Solution:** Kill process: `lsof -i :2026 | grep sage-api | awk '{print $2}' | xargs kill -9`

---

## MAS Review Preparation

When submitting to Mac App Store:

1. **Document Entitlements**: Explain why each entitlement is needed
   - JIT compilation for Node.js
   - Network access for API communication
   - File system access for app-specific directories

2. **Explain Sandbox Model**:
   - Frontend is native Swift/Tauri app
   - Backend is Node.js API server in sidecar
   - Communication via localhost IPC

3. **Security Justification**:
   - All file access restricted to app container
   - No access to user home directory (except container)
   - No access to other app directories
   - Network restricted to localhost (in strict entitlements)

4. **Testing Results**:
   - Include results of tests above
   - Verify all compliance checks pass
   - Document migration behavior

---

## Additional Resources

- [macOS App Store Sandbox Documentation](https://developer.apple.com/documentation/security/app_sandbox)
- [Tauri macOS Documentation](https://tauri.app/docs/guides/features/system-tray/)
- [Entitlements Reference](https://developer.apple.com/documentation/bundleresources/entitlements)

