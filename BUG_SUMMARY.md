# Bug Summary: Deleted Sessions Reappear

## TL;DR - The Problem

When a user deletes a **channel-originated task** (from WeChat, Feishu, etc.) and **restarts the app**, the task mysteriously reappears in the sidebar.

Regular (non-channel) tasks don't have this problem.

---

## Why It Happens (3 Key Issues)

### 🔴 Issue #1: Non-awaited Backend Deletion
**File:** `src/app/pages/Home.tsx` (line 108)

The frontend fires a DELETE request but never waits for it:
```typescript
fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { method: 'DELETE' }).catch(() => {});
//     ^ fires but doesn't await
```

**Impact:** If the request fails or is slow, the backend still has the conversation.

---

### 🔴 Issue #2: Volatile Deletion Tracking
**File:** `src/shared/hooks/useChannelSync.ts` (lines 48-70)

Deleted task IDs are stored in `sessionStorage`, which is **cleared when the app restarts**:
```typescript
const DELETED_KEY = 'channelSync:deletedIds';

function getDeletedIds(): Set<string> {
  const raw = sessionStorage.getItem(DELETED_KEY); // ← cleared on app restart
  return raw ? new Set(JSON.parse(raw)) : new Set();
}
```

**Impact:** After restart, the frontend forgets which tasks were deleted.

---

### 🔴 Issue #3: Backend Persistence Survives Deletion
**File:** `src-api/src/shared/services/channel-store.ts`

Channel conversations are persisted to disk (`~/.htclaw/channel-conversations.json`). Even if the in-memory deletion works, there's a 2-second debounce before flushing to disk. If the app restarts before the flush, the disk file still has the old conversation.

**Impact:** On next app startup, the conversation is reloaded from disk.

---

## The Reproduction Steps

1. ✅ Have a channel connected (WeChat, Feishu)
2. ✅ Receive a message → task appears in sidebar
3. ✅ Delete the task from the UI
4. ✅ **Restart the app**
5. ❌ **Task reappears**

---

## What Actually Happens During Restart

```
Before Restart:
  Backend: conversations = {taskId: conv}  (still in memory/disk)
  Frontend: sessionStorage.deletedIds = {taskId}

After Restart (sessionStorage is cleared):
  sessionStorage.deletedIds = {} (empty!)
  
Channel Sync Polling:
  1. Fetch all conversations from backend
  2. Backend returns [taskId: conv]
  3. Frontend checks: deletedIds.has(taskId) → FALSE (forgotten!)
  4. Frontend checks: getTask(taskId) → null (was deleted)
  5. Frontend: "New task, let me create it!"
  6. Task reappears in sidebar ❌
```

---

## The Fix (Quick Version)

### 1. Wait for Backend Deletion
```typescript
// Before (Home.tsx, line 108):
fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { 
  method: 'DELETE' 
}).catch(() => {});

// After:
try {
  const response = await fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { 
    method: 'DELETE' 
  });
  if (!response.ok) {
    console.warn('Failed to delete from backend:', response.status);
  }
} catch (error) {
  console.warn('Failed to delete from backend:', error);
}
```

### 2. Use localStorage Instead of sessionStorage
```typescript
// Before (useChannelSync.ts, line 48):
const DELETED_KEY = 'channelSync:deletedIds';

// After:
const DELETED_KEY = 'channelSync:deletedIds_v1';

function getDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY); // ← survives app restart
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
```

### 3. Clear localStorage When Task Is Synced
In `useChannelSync.ts`, after successfully syncing a task:
```typescript
// After creating task from backend conversation:
// Clear it from deleted tracking so it can be synced again if needed
const deletedIds = getDeletedIds();
deletedIds.delete(taskId);
localStorage.setItem(DELETED_KEY, JSON.stringify([...deletedIds]));
```

---

## The Root Cause Architecture

```
Channel Message from WeChat/Feishu
  ↓
Backend In-Memory: conversations.set(id, conv)
Backend Disk: ~/.htclaw/channel-conversations.json (after 2s flush)
  ↓
Frontend Polls Every 3 Seconds: /channels/conversations/all
  ↓
Frontend Checks Deleted List: sessionStorage.deletedIds
  ↓
On App Restart: sessionStorage is cleared ← 💥 BUG
  ↓
Frontend Recreates Task from Backend Data
```

---

## Files to Modify

| File | Issue | Fix |
|------|-------|-----|
| `src/app/pages/Home.tsx` | Non-awaited DELETE | Await the fetch |
| `src/shared/hooks/useChannelSync.ts` | Volatile deletion tracking | Use `localStorage` |
| `src-api/src/shared/services/channel-store.ts` | (Optional) Add soft delete flag | Improve robustness |

---

## Priority

🔴 **HIGH** - This affects user data integrity. Deleted tasks should not reappear.

---

## Related Code Sections

**Frontend Delete Handler:**
- `src/app/pages/Home.tsx:102-113` - handleDeleteTask()
- `src/components/layout/left-sidebar.tsx:164-173` - handleConfirmDelete()

**Sync Loop:**
- `src/shared/hooks/useChannelSync.ts:72-195` - syncOnce()
- `src/shared/hooks/useChannelSync.ts:48-70` - getDeletedIds()

**Backend Channel Store:**
- `src-api/src/app/api/channels.ts:125-129` - DELETE endpoint
- `src-api/src/shared/services/channel-store.ts:234-248` - deleteConversation()
- `src-api/src/shared/services/channel-store.ts:55-110` - Persistence layer

---

## Testing After Fix

```bash
# 1. Have a WeChat message create a task
# 2. Delete the task
# 3. Restart the app
# 4. Task should NOT reappear ✓

# 5. Verify with DevTools:
#    localStorage should still have deletedIds entry
localStorage.getItem('channelSync:deletedIds_v1')
# Output: ["ch-1234-abcd", "ch-5678-efgh"]
```
