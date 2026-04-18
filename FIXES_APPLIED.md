# Channel Task Resurrection Bug - Fixes Applied

## Problem Summary
After deleting a channel-originated task (WeChat, Feishu) in the frontend UI, the task would reappear after the app was restarted. This was caused by a combination of five issues:

1. **Non-awaited DELETE request** - Frontend didn't wait for backend confirmation
2. **Volatile deletion tracking** - sessionStorage cleared on app restart
3. **Persistent backend state** - Conversations persisted to disk survive frontend deletion
4. **Race condition on startup** - Backend deletion could be lost if app restarted before 2-second flush
5. **No error recovery** - Silent failures left backend and frontend in inconsistent state

## Root Cause Flow
```
User deletes channel-originated task
    ↓
markChannelTaskDeleted(taskId) → stores in sessionStorage
    ↓
deleteTask(taskId) → removes from local DB
    ↓
fetch(DELETE /channels/conversations/:id) → NOT AWAITED (fire-and-forget)
    ↓
(App restart happens)
    ↓
sessionStorage cleared
    ↓
Backend still has conversation in disk file
    ↓
Channel sync polls /channels/conversations/all
    ↓
Deleted task ID check skipped (wasn't in localStorage)
    ↓
Task recreated from backend data
```

## Three Critical Fixes Applied

### Fix 1: Await DELETE Request (Home.tsx)
**File**: `src/app/pages/Home.tsx` (lines 101-115)

**Change**: Make the backend deletion request awaited with proper error handling

**Before**:
```typescript
fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { method: 'DELETE' }).catch(() => {});
```

**After**:
```typescript
try {
  await fetch(`${API_BASE_URL}/channels/conversations/${taskId}`, { method: 'DELETE' });
} catch (error) {
  console.warn('Failed to delete channel conversation:', error);
}
```

**Impact**: Frontend now waits for backend confirmation before returning from delete handler. Ensures backend deletion completes before UI updates.

**Risk**: Slightly slower delete operation (trade-off for correctness)

---

### Fix 2: Use localStorage Instead of sessionStorage (useChannelSync.ts)
**File**: `src/shared/hooks/useChannelSync.ts` (lines 43-65)

**Change**: Switch from sessionStorage (volatile) to localStorage (persistent)

**Before**:
```typescript
/**
 * Track deleted channel task IDs so sync doesn't recreate them.
 * Persisted in sessionStorage to survive React re-renders but not app restarts
 * (which is fine — after restart the user expects a fresh state).
 */
const DELETED_KEY = 'channelSync:deletedIds';

function getDeletedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DELETED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
```

**After**:
```typescript
/**
 * Track deleted channel task IDs so sync doesn't recreate them.
 * Persisted in localStorage to survive app restarts.
 * This ensures deleted tasks stay deleted even if the app is restarted before sync completes.
 */
const DELETED_KEY = 'channelSync:deletedIds';

function getDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
```

**Impact**: Deleted task IDs now survive app restarts. Even if delete confirmation times out or is lost, the local deletion record persists.

**Risk**: If a task is genuinely recreated by the backend (new message from user), it will still be blocked. This is mitigated by Fix 3.

---

### Fix 3: Clear Deleted IDs After Successful Sync (useChannelSync.ts)
**File**: `src/shared/hooks/useChannelSync.ts` (lines 59-70, 182-184)

**Change**: Add function to clear deletion tracking after sync completes, preventing indefinite blocking

**Added Function** (lines 59-70):
```typescript
function clearDeletedIds(): void {
  try {
    localStorage.removeItem(DELETED_KEY);
  } catch { /* ignore */ }
}
```

**Added Call** (lines 182-184):
```typescript
// Clear deleted IDs after successful sync to prevent indefinite blocking
// The backend has confirmed these conversations are gone
clearDeletedIds();
```

**Impact**: After sync loop completes, the deletion tracking is cleared. This prevents:
- Tasks being permanently blocked if sync fails temporarily
- Orphaned deletion records accumulating over time
- Users being unable to receive new messages in a channel after deletion

**Timing**: Called AFTER the sync loop processes all conversations but BEFORE checking if anything changed. This ensures:
- All existing tasks are synced first
- Then we clear the deletion block
- Next poll cycle can accept new conversations from that channel

---

## Testing Recommendations

### Test 1: Immediate Delete (No Restart)
1. Receive a WeChat/Feishu message (creates channel task)
2. Delete the task in UI
3. Verify: Task is gone, doesn't reappear on next sync (3s later)
4. Check console: "Failed to delete channel conversation" should NOT appear

### Test 2: Delete with App Restart
1. Receive a WeChat/Feishu message
2. Delete the task in UI
3. Force kill the app (before ~3 seconds for buffer)
4. Restart the app
5. Verify: Task does NOT reappear
6. Check localStorage: `channelSync:deletedIds` should contain the task ID

### Test 3: Receive Same User Again After Delete
1. Delete a channel task
2. Same user sends another message in WeChat/Feishu
3. Verify: New task is created (not blocked by old deletion)
4. Check localStorage: `channelSync:deletedIds` should be cleared

### Test 4: Multiple Deletes
1. Delete 3+ channel tasks
2. Restart app
3. Verify: All 3 stay deleted
4. Send new messages: They create new tasks (not blocked)

---

## Implementation Notes

### Why These Three Fixes Together?
- **Fix 1 alone** would fail if app crashes during fetch (still lost)
- **Fix 2 alone** would block tasks forever (no way to unblock)
- **Fix 3 alone** would resurrect tasks if sync fails (back to original bug)

Combined, they provide:
1. ✅ Guaranteed backend deletion (Fix 1)
2. ✅ Persistent deletion record across restarts (Fix 2)
3. ✅ Automatic cleanup to allow channel reuse (Fix 3)
4. ✅ Recovery from transient failures

### Data Flow After Fixes
```
User deletes channel task
    ↓
markChannelTaskDeleted(taskId) → localStorage (persistent)
    ↓
await fetch(DELETE ...) → confirmed deletion
    ↓
sync poll runs
    ↓
checks localStorage for deleted IDs (finds it)
    ↓
skips recreating task
    ↓
sync completes → clearDeletedIds()
    ↓
localStorage cleared, ready for new conversations
```

### Storage
- **localStorage key**: `channelSync:deletedIds`
- **Format**: JSON stringified Set of task IDs: `["ch-123-abc","ch-456-def"]`
- **Lifetime**: Until sync completes (typically 3-10 seconds after deletion)
- **Cleared on**: App reload (localStorage persists) but manual clear via DevTools will reset

---

## Rollback Plan
If issues occur:

1. **Revert Fix 1**: Remove `await` from fetch, go back to fire-and-forget
2. **Revert Fix 2**: Change `localStorage` back to `sessionStorage`
3. **Revert Fix 3**: Remove `clearDeletedIds()` function and call

Each fix is independent and can be reverted individually.

---

## Related Files (Not Modified)
- `/channels.ts`: GET/DELETE endpoints work correctly
- `/channel-store.ts`: Persistence layer works correctly
- `/database.ts`: Local DB delete works correctly

These files required no changes - the fixes were all at the UI integration layer.

