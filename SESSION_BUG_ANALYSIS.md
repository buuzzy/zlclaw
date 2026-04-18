# Session Management Bug Analysis: Why Deleted Sessions Reappear

## Executive Summary

The bug occurs because **deleted tasks can be recreated by the channel sync mechanism**, which polls the backend for channel conversations every 3 seconds and compares them against the local database. If a channel-originated task is deleted from the frontend UI but still exists in the backend's channel store, it will be re-synced to the frontend, causing it to reappear.

The frontend has a `deleted IDs` tracking mechanism in `sessionStorage` that's supposed to prevent this, but it only survives during the current session. After an app restart, the tracking is lost, and channels sync can recreate the task.

---

## Complete Flow: Frontend Delete → Backend Persistence → Re-sync Loop

### 1. Frontend Delete Action (left-sidebar.tsx, line 164)

When the user clicks "Delete" on a task in the sidebar:

```typescript
const handleConfirmDelete = () => {
  if (taskToDelete && onDeleteTask) {
    onDeleteTask(taskToDelete);  // ← calls handleDeleteTask from Home.tsx
    if (taskToDelete === currentTaskId) {
      navigate('/');
    }
  }
  setTaskToDelete(null);
};
```

### 2. Frontend Delete Implementation (Home.tsx, line 102-113)

```typescript
const handleDeleteTask = async (taskId: string) => {
  try {
    // Mark as deleted so channel sync won't recreate it
    markChannelTaskDeleted(taskId);  // ← stores in sessionStorage
    await deleteTask(taskId);         // ← removes from local IndexedDB/SQLite
    
    // Also delete from backend channel store (prevents resurrection after restart)
    fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { 
      method: 'DELETE' 
    }).catch(() => {});  // ← fires but doesn't wait
    
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  } catch (error) {
    console.error('Failed to delete task:', error);
  }
};
```

**KEY ISSUE #1:** The fetch to delete from backend is not awaited, so if it fails or is slow, 
the task might still exist in the backend store.

### 3. Session Storage Tracking (useChannelSync.ts, line 48-70)

The frontend tries to prevent re-sync of deleted tasks by storing deleted IDs in `sessionStorage`:

```typescript
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
```

**LIMITATION:** `sessionStorage` is volatile—it's cleared when:
- The browser tab/window closes
- The Tauri app is restarted
- `sessionStorage.clear()` is called

**KEY ISSUE #2:** After app restart, `sessionStorage` is empty, so deleted channel task IDs are forgotten.

### 4. Channel Sync Loop (useChannelSync.ts, line 72-195)

Every 3 seconds, the frontend polls the backend:

```typescript
const POLL_INTERVAL = 3000;

const syncOnce = useCallback(async () => {
  if (syncingRef.current) return;
  syncingRef.current = true;

  try {
    const res = await fetch(`${API_BASE_URL}/channels/conversations/all`);
    if (!res.ok) {
      console.warn('[ChannelSync] Poll failed:', res.status);
      return;
    }

    const data = (await res.json()) as {
      total: number;
      conversations: ChannelConversation[];
    };

    if (!data.conversations?.length) return;

    const deletedIds = getDeletedIds();  // ← reads from sessionStorage
    let changed = false;

    for (const conv of data.conversations) {
      try {
        const taskId = conv.id;
        // Skip tasks the user has explicitly deleted
        if (deletedIds.has(taskId)) continue;  // ← only if still in sessionStorage

        const existing = await getTask(taskId);

        if (!existing) {
          // CREATE TASK IF NOT IN LOCAL DB
          await createTask({
            id: taskId,
            session_id: sessionId,
            task_index: 1,
            prompt: `[${channelLabel}] ${conv.prompt}`,
          });
          changed = true;
        }
        // ... handle updates
      } catch (err) {
        console.error('[ChannelSync] Failed to sync', conv.id, err);
      }
    }

    if (changed) {
      onNewTask?.();  // ← triggers loadTasks() → setState(tasks) → UI updates
    }
  } finally {
    syncingRef.current = false;
  }
}, [onNewTask]);
```

**KEY ISSUE #3:** If `sessionStorage` is cleared (e.g., app restart), `getDeletedIds()` returns an empty Set, 
and any task that still exists in the backend's `conversations` map will be re-synced.

### 5. Backend Channel Store (src-api/src/shared/services/channel-store.ts)

The backend maintains channel conversations in two layers:

#### Layer 1: In-Memory Store
```typescript
const conversations = _loadedConvs;  // Map<id, ChannelConversation>
const activeConvByChannel = _loadedActive;  // Map<channelId, conversationId>
```

#### Layer 2: Disk Persistence
```typescript
function getPersistPath(): string {
  const dir = getAppDataDir();
  return join(dir, 'channel-conversations.json');
}

function flushToDisk(): void {
  try {
    const state: PersistedState = {
      conversations: Array.from(conversations.entries()),
      activeConvByChannel: Array.from(activeConvByChannel.entries()),
    };
    writeFileSync(getPersistPath(), JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('[ChannelStore] Failed to persist to disk:', err);
  }
}
```

**KEY ISSUE #4:** When a channel message is received (e.g., WeChat), it's stored in the backend via 
`appendOrCreateConversation()`, which marks `synced: false`. The frontend then polls it, creates a task, 
and the backend would be marked `synced: true` via the frontend calling POST `/channels/conversations/synced`. 
**But if the frontend's DELETE to the backend endpoint fails or is not awaited, the backend still has the conversation.**

### 6. DELETE Endpoint (src-api/src/app/api/channels.ts, line 125-129)

```typescript
channelRoutes.delete('/conversations/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteConversation(id);
  return c.json({ ok: deleted });
});
```

And the service:

```typescript
export function deleteConversation(id: string): boolean {
  const conv = conversations.get(id);
  if (!conv) return false;
  conversations.delete(id);
  // Also clean up activeConvByChannel if it points to this conversation
  for (const [channel, activeId] of activeConvByChannel) {
    if (activeId === id) {
      activeConvByChannel.delete(channel);
    }
  }
  schedulePersist();  // ← flushes to disk after 2s
  console.log(`[ChannelStore] Deleted conversation ${id}`);
  return true;
}
```

**The delete endpoint works correctly**, but:
- The frontend doesn't wait for it
- If the backend restarts before the 2-second debounce, the deletion is lost
- The disk file `~/.htclaw/channel-conversations.json` still has the old conversation

---

## Root Causes Summary

1. **Non-awaited DELETE request** (Home.tsx)
   - Frontend fires `DELETE /channels/conversations/{taskId}` but doesn't await it
   - If the request fails or times out, the backend never deletes it

2. **Volatile deletion tracking** (useChannelSync.ts)
   - `sessionStorage` is cleared on app restart
   - After restart, `getDeletedIds()` returns empty Set
   - Channel sync doesn't know which tasks were deleted

3. **Backend persistence survives frontend deletion** (channel-store.ts)
   - Conversations persist to disk (`channel-conversations.json`)
   - Even if in-memory deletion works, disk file isn't cleaned up immediately
   - On backend restart, disk state is reloaded → conversations are back

4. **Race condition on app startup**
   - If app restarts before the 2-second debounce to persist the deletion
   - The in-memory deletion is lost
   - On next startup, the disk file is reloaded with the old conversations

5. **No recovery mechanism after deletion request fails**
   - If `fetch().catch(() => {})` silently fails, no retry or notification
   - Frontend thinks deletion succeeded, but backend still has it

---

## Scenario: Why Tasks Reappear After Deletion

### Scenario A: Same Session (Current Bug - Usually Observed)
1. User deletes a channel-originated task
2. Frontend calls `markChannelTaskDeleted(taskId)` → stored in `sessionStorage`
3. Frontend calls `deleteTask(taskId)` → removed from local DB
4. Frontend fires `DELETE /channels/conversations/{taskId}` but doesn't await
5. DELETE request fails or is slow
6. Next poll interval (3s), channel sync fetches all conversations
7. **Backend still has the conversation** (because DELETE failed)
8. Frontend's `getDeletedIds()` still has the taskId in `sessionStorage` → sync skips it ✓ WORKS
9. Task doesn't reappear in current session

**But if the user scrolls, reloads, or reopens the sidebar:**
10. `loadTasks()` is called → fetches from local DB
11. Task is NOT in local DB (it was deleted) ✓ WORKS
12. Task doesn't appear

### Scenario B: After App Restart (The Real Bug - Hard to Notice)
1. User deletes a channel-originated task
2. Steps 2-5 same as above
3. User restarts the app
4. `sessionStorage` is cleared
5. Backend still has the conversation in:
   - In-memory map (if backend didn't restart)
   - Disk file `~/.htclaw/channel-conversations.json` (always)
6. Frontend boots, calls `useChannelSync` hook
7. First poll fetches `/channels/conversations/all`
8. `getDeletedIds()` returns empty Set (sessionStorage is cleared)
9. **Backend returns the conversation** (it never was deleted)
10. Frontend's sync checks: `deletedIds.has(taskId)` → false → proceeds to sync
11. Frontend checks: `existing = await getTask(taskId)` → null (deleted from local DB)
12. Frontend: "New task!" → calls `createTask()`
13. **Task reappears in the sidebar** ❌ BUG

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CHANNEL MESSAGE FLOW                     │
└─────────────────────────────────────────────────────────────┘

  WeChat/Feishu         Backend Channel Store         Frontend
  ============         ====================          ========
                            in-memory:
                        conversations{id→conv}
                        activeConvByChannel
                                ↓
                            on disk:
                        ~/.htclaw/
                        channel-conversations.json


  User message ────→ Webhook ──→ handleIncomingMessage()
                                      ↓
                        appendOrCreateConversation()
                                      ↓
                        conversations.set(id, conv)
                        activeConvByChannel.set(ch, id)
                        schedulePersist()
                                      ↓
                        (2s debounce)
                                      ↓
                        flushToDisk() writes JSON

                                      ↑
                        ┌──────────────┴──────────────┐
                        │  POLL EVERY 3 SECONDS       │
                        │ /channels/conversations/all │
                        └──────────────┬──────────────┘
                                      ↓
  
  sessionStorage                 getAllChannelConversations()
  deletedIds set ←────────────→  returns [conv1, conv2, ...]
                                      ↓
                            for each conv:
                            if (deletedIds.has(conv.id)) skip
                            if (getTask(conv.id) exists) skip
                            else createTask() → local DB


┌─────────────────────────────────────────────────────────────┐
│           DELETE FLOW (WHERE THE BUG HAPPENS)              │
└─────────────────────────────────────────────────────────────┘

  Frontend                                Backend
  ========                                =======
  
  User clicks Delete
        ↓
  markChannelTaskDeleted(taskId)
  // stores in sessionStorage ✓
        ↓
  deleteTask(taskId)
  // removes from local DB ✓
        ↓
  fetch(DELETE /channels/conversations/{taskId})
  // NOT awaited, no error handling ← BUG #1
  .catch(() => {})
        │
        ├─→ [Network fails / times out]
        │   Backend still has: conversations.get(taskId) = conv
        │                  ↓
        │        No cleanup happens
        │
        └─→ [Success] deleteConversation(taskId)
            conversations.delete(taskId) ✓
            schedulePersist()
                  ↓
            (2s debounce)
                  ↓
            IF backend restarts before flush:
                Disk file still has conversation ← BUG #4
                
            IF backend persists:
            writeFileSync() removes it ✓
            
            BUT if app restarts before 2s debounce:
                In-memory deleted
                Disk file NOT updated yet
                On next startup:
                loadFromDisk() reloads old conversation ← BUG #3


  ON APP RESTART:
  sessionStorage cleared ← BUG #2
        ↓
  getDeletedIds() = empty Set
        ↓
  Poll shows backend still has conversation
        ↓
  deletedIds.has(taskId) = false (was forgotten)
        ↓
  createTask() ← TASK REAPPEARS ❌
```

---

## Files Involved

### Frontend
- **src/app/pages/Home.tsx** (lines 102-113)
  - `handleDeleteTask()`: fires DELETE without awaiting
  
- **src/components/layout/left-sidebar.tsx** (lines 164-173)
  - `handleConfirmDelete()`: calls the delete handler
  
- **src/shared/hooks/useChannelSync.ts** (lines 48-195)
  - `getDeletedIds()`: reads from sessionStorage (volatile)
  - `markChannelTaskDeleted()`: writes to sessionStorage
  - `syncOnce()`: polls backend and re-syncs tasks

- **src/shared/db/database.ts** (lines 465-482)
  - `deleteTask()`: removes from local DB only

### Backend
- **src-api/src/app/api/channels.ts** (lines 125-129)
  - DELETE endpoint: deletes from in-memory map
  
- **src-api/src/shared/services/channel-store.ts** (lines 234-248)
  - `deleteConversation()`: deletes and schedules persist
  - Persistence layer: loadFromDisk(), flushToDisk()

---

## Recommended Fixes

### Short Term (Quick Fix)
1. **Await the DELETE request** in Home.tsx
   ```typescript
   try {
     await fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { 
       method: 'DELETE' 
     });
   } catch (error) {
     console.warn('Failed to delete from backend:', error);
   }
   ```

2. **Persist deletions to localStorage** instead of sessionStorage
   ```typescript
   const DELETED_KEY = 'channelSync:deletedIds_v1';
   
   function getDeletedIds(): Set<string> {
     try {
       const raw = localStorage.getItem(DELETED_KEY);
       return raw ? new Set(JSON.parse(raw)) : new Set();
     } catch {
       return new Set();
     }
   }
   ```

3. **Add a confirmation flow** to make sure backend deletion succeeds before removing from UI

### Medium Term (Robust Fix)
1. **Use a database table** instead of sessionStorage to track deleted channel tasks
   - Add `deleted_channel_tasks` table to IndexedDB/SQLite
   - Persist across restarts
   - Backend can be informed of already-deleted IDs

2. **Implement soft deletes** on the backend
   - Add `deleted: boolean` field to ChannelConversation
   - DELETE marks it deleted but doesn't remove it
   - Frontend sync respects the deleted flag

3. **Add versioning** to track conversation updates
   - Backend sends a version number (already has this!)
   - Frontend can detect when a conversation was deleted by version mismatch

### Long Term (Architectural Fix)
1. **Replace polling with WebSocket** for real-time sync
   - No race conditions with 3-second polling windows
   - Immediate deletion propagation

2. **Implement conflict-free replicated data type** (CRDT) for tasks
   - Immutable operations with timestamps
   - Deletion is an operation, not a state removal
   - No reappearance possible

3. **Use transaction-based sync**
   - Frontend and backend agree on a consistent version
   - No stale data from disk persist

---

## Testing the Bug

1. **Channel-originated task (easy to reproduce)**
   - Ensure you have WeChat or Feishu connected
   - Receive a message
   - A task should appear in the sidebar
   - Delete the task
   - Restart the app
   - The task reappears ✓ BUG CONFIRMED

2. **Regular task (unlikely to trigger)**
   - Create a task manually
   - Delete it
   - Restart app
   - Task should NOT reappear (no backend channel conversation to restore)

3. **Network failure scenario**
   - Use DevTools to disable network
   - Delete a channel task
   - The DELETE request fails silently
   - Task disappears from UI
   - Restart app
   - Reconnect network
   - Task reappears ✓ BUG CONFIRMED
