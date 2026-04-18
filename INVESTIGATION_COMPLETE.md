# Session Reappearance Bug: Investigation Complete ✓

## Documents Created

I've created three comprehensive analysis documents in this directory:

1. **`BUG_SUMMARY.md`** — Quick overview (2 min read)
   - TL;DR of the problem
   - 3 key issues explained
   - Quick fix instructions
   - Files to modify

2. **`SESSION_BUG_ANALYSIS.md`** — Full technical analysis (15 min read)
   - Complete root cause analysis
   - All 5 contributing issues
   - Full call chain documentation
   - Recommended fixes (short/medium/long term)
   - Testing procedures
   - Data flow diagrams

3. **`CODE_MAP.md`** — Line-by-line code reference (5 min read)
   - Complete call chain with line numbers
   - File locations and key functions
   - Persistence layer architecture
   - The bug in state table format

---

## The Bug Explained in 60 Seconds

**Problem:** After deleting a task from a channel (WeChat/Feishu) and restarting the app, the task reappears.

**Why:** Three issues combine:

1. **Frontend doesn't wait** for backend delete (`src/app/pages/Home.tsx:108`)
   ```typescript
   fetch(DELETE).catch(() => {})  // not awaited
   ```

2. **Deleted task IDs stored in sessionStorage** (`src/shared/hooks/useChannelSync.ts:48`)
   - sessionStorage is cleared on app restart
   - After restart, the app forgets which tasks were deleted

3. **Backend stores conversations on disk** (`src-api/channel-conversations.json`)
   - Survives app restart
   - Channel sync re-creates the task because the frontend forgot it was deleted

**Result:** Task reappears after restart

---

## Quick Fix Checklist

- [ ] **File 1:** `src/app/pages/Home.tsx` (line 108)
  - **Change:** Await the DELETE request
  - **Why:** Ensure backend deletion actually completes
  
- [ ] **File 2:** `src/shared/hooks/useChannelSync.ts` (lines 48-70)
  - **Change:** Use `localStorage` instead of `sessionStorage`
  - **Why:** localStorage survives app restart, sessionStorage doesn't
  
- [ ] **File 3:** `src/shared/hooks/useChannelSync.ts` (after line 122)
  - **Change:** Clear the deleted ID from tracking after successfully syncing
  - **Why:** Allows previously deleted tasks to be re-synced if needed

---

## Code Changes Required

### Change 1: Await Backend Deletion

**File:** `src/app/pages/Home.tsx` (lines 102-113)

```typescript
// BEFORE
const handleDeleteTask = async (taskId: string) => {
  try {
    markChannelTaskDeleted(taskId);
    await deleteTask(taskId);
    fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { method: 'DELETE' }).catch(() => {});
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  } catch (error) {
    console.error('Failed to delete task:', error);
  }
};

// AFTER
const handleDeleteTask = async (taskId: string) => {
  try {
    markChannelTaskDeleted(taskId);
    await deleteTask(taskId);
    
    // Wait for backend deletion before continuing
    try {
      const response = await fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { 
        method: 'DELETE' 
      });
      if (!response.ok) {
        console.warn(`[Delete] Failed to delete from backend: ${response.status}`);
      }
    } catch (error) {
      console.warn('[Delete] Failed to delete from backend:', error);
    }
    
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  } catch (error) {
    console.error('Failed to delete task:', error);
  }
};
```

### Change 2: Use localStorage for Deletion Tracking

**File:** `src/shared/hooks/useChannelSync.ts` (lines 48-70)

```typescript
// BEFORE
const DELETED_KEY = 'channelSync:deletedIds';

function getDeletedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DELETED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addDeletedId(id: string): void {
  const ids = getDeletedIds();
  ids.add(id);
  try {
    sessionStorage.setItem(DELETED_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

// AFTER
const DELETED_KEY = 'channelSync:deletedIds_v1';

function getDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY);  // ← changed to localStorage
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addDeletedId(id: string): void {
  const ids = getDeletedIds();
  ids.add(id);
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...ids]));  // ← changed to localStorage
  } catch { /* ignore */ }
}
```

### Change 3: Clear Deleted Tracking After Sync

**File:** `src/shared/hooks/useChannelSync.ts` (after line 122, inside the `if (!existing)` block)

```typescript
// Inside syncOnce() callback, after createTask() call:

if (!existing) {
  const channelLabel = CHANNEL_LABELS[conv.channel] ?? conv.channel;
  const sessionId = `ch_${conv.createdAt}`;

  try {
    await createSession({
      id: sessionId,
      prompt: `[${channelLabel}] ${conv.prompt}`,
    });
  } catch {
    // session may already exist
  }

  await createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 1,
    prompt: `[${channelLabel}] ${conv.prompt}`,
  });

  for (const msg of conv.messages) {
    await createMessage({
      task_id: taskId,
      type: msg.role === 'user' ? 'user' : 'text',
      content: msg.content,
    });
  }

  // NEW: Clear from deleted tracking since we just synced it
  const deletedIds = getDeletedIds();
  if (deletedIds.has(taskId)) {
    deletedIds.delete(taskId);
    try {
      localStorage.setItem(DELETED_KEY, JSON.stringify([...deletedIds]));
    } catch { /* ignore */ }
  }

  console.log('[ChannelSync] Created task:', taskId);
  changed = true;
}
```

---

## Verification Steps

After applying the fixes:

1. **Have a channel connected** (WeChat, Feishu, etc.)
2. **Receive a message** → task appears in sidebar
3. **Delete the task** → it disappears
4. **Restart the app** → task should NOT reappear ✓
5. **Check browser DevTools:**
   ```javascript
   localStorage.getItem('channelSync:deletedIds_v1')
   // Should show the deleted task ID
   ```

---

## Files Analyzed

### Frontend
- ✅ `src/app/pages/Home.tsx` — Task deletion handler
- ✅ `src/components/layout/left-sidebar.tsx` — Delete UI
- ✅ `src/shared/hooks/useChannelSync.ts` — Channel sync loop
- ✅ `src/shared/db/database.ts` — Local DB operations
- ✅ `src/shared/lib/session.ts` — Session utilities

### Backend
- ✅ `src-api/src/app/api/channels.ts` — Channel API endpoints
- ✅ `src-api/src/shared/services/channel-store.ts` — Channel persistence
- ✅ `src-api/src/shared/context/session-store.ts` — Session context storage
- ✅ `src-api/src/index.ts` — Route registration

### Configuration
- ✅ `package.json` — Project structure
- ✅ `vite.config.ts` — Build configuration
- ✅ `tsconfig.json` — TypeScript configuration

---

## Why This Bug Happens

```
Channel Message Received
    ↓ (webhook from WeChat/Feishu)
    ↓
Backend: appendOrCreateConversation()
    ↓ persists to disk + in-memory
    ↓
Frontend: Polling loop every 3 seconds
    ↓
GET /channels/conversations/all
    ↓ returns all conversations
    ↓
User Deletes Task in UI
    ↓
Frontend: sessionStorage.deletedIds = {taskId}
    ↓ (volatile!)
    ↓
Async DELETE /channels/conversations/{taskId} (not awaited)
    ↓ (may fail silently)
    ↓
APP RESTART
    ↓
sessionStorage cleared ← 🔴 PROBLEM
    ↓
Backend: Load conversations from disk
    ↓ (includes deleted conversation)
    ↓
Frontend: getDeletedIds() = {} (empty, forgotten!)
    ↓
Sync loop: "I see this conversation, and frontend doesn't have it"
    ↓
createTask() ← TASK REAPPEARS ❌
```

---

## Summary

This investigation uncovered a **complex multi-layer bug** involving:
- Volatile frontend storage (sessionStorage)
- Non-awaited async operations
- Backend persistence that survives deletion
- A 3-second polling mechanism that lacks proper synchronization

The fix is **straightforward** (3 small code changes) but the bug is **subtle** 
(only manifests after app restart, only for channel-originated tasks).

All analysis documents are saved in this directory for reference.

---

## Next Steps

1. Apply the 3 code changes (15 minutes)
2. Test the reproduction scenario (5 minutes)
3. Verify with DevTools (2 minutes)
4. Commit the fixes (2 minutes)

**Total time to fix: ~30 minutes**

---

*Investigation completed by analyzing all relevant code paths, understanding the persistence layers, 
and tracing through the complete request/response flows. All root causes identified and documented.*
