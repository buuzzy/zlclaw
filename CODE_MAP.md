# Session Management Code Map

## Complete Call Chain: Delete Action → Reappearance

```
USER DELETES TASK
     ↓
     ├─ left-sidebar.tsx:158
     │  └─ handleDeleteClick(taskId)
     │     └─ setDeleteDialogOpen(true)
     │
     ├─ User confirms deletion
     │
     ├─ left-sidebar.tsx:164
     │  └─ handleConfirmDelete()
     │     └─ onDeleteTask(taskToDelete)
     │        ↓
     │        HOME.TSX: handleDeleteTask(taskId) [line 102]
     │        ├─ markChannelTaskDeleted(taskId)
     │        │  └─ useChannelSync.ts:68
     │        │     └─ sessionStorage.setItem('channelSync:deletedIds', JSON.stringify([...ids]))
     │        │        ✓ Stores deleted ID in volatile session storage
     │        │
     │        ├─ deleteTask(taskId)
     │        │  └─ database.ts:465
     │        │     └─ DELETE FROM tasks WHERE id = ?
     │        │        ✓ Removes from local SQLite/IndexedDB
     │        │
     │        └─ fetch(DELETE /channels/conversations/{taskId}) [line 108]
     │           ❌ NOT AWAITED - fires and forgets
     │           └─ Backend: deleteConversation(id) [channel-store.ts:235]
     │              ├─ conversations.delete(id)
     │              │  ✓ Removes from in-memory map
     │              │
     │              ├─ activeConvByChannel cleanup
     │              │  ✓ Removes active session pointer
     │              │
     │              └─ schedulePersist()
     │                 └─ (2s debounce) → flushToDisk()
     │                    └─ writeFileSync(~/.htclaw/channel-conversations.json)
     │                       ✓ Would persist deletion, but...
     │
     └─ setTasks(prev => prev.filter(t => t.id !== taskId))
        ✓ UI updates, task disappears from sidebar
```

---

## After App Restart

```
APP RESTARTS
     ↓
     ├─ sessionStorage is cleared ← 🔴 PROBLEM #1
     │  └─ getDeletedIds() now returns empty Set
     │
     ├─ Backend Re-initialization
     │  └─ if (!sqliteDb) await Database.load(SQLITE_DB_NAME) [database.ts:116]
     │     └─ Local DB is loaded
     │
     └─ Home.tsx useEffect [line 91]
        ├─ loadTasks()
        │  └─ getAllTasks() [database.ts:362]
        │     └─ SELECT * FROM tasks
        │        ✓ Deleted task is NOT here
        │
        └─ useChannelSync hook [Home.tsx:99]
           └─ syncOnce() [useChannelSync.ts:76]
              ├─ fetch('/channels/conversations/all') [line 81]
              │  └─ Backend: getAllChannelConversations() [channel-store.ts:228]
              │     ├─ Load from disk if needed
              │     │  └─ loadFromDisk() [channel-store.ts:55]
              │     │     └─ readFileSync(~/.htclaw/channel-conversations.json)
              │     │        ❌ IF flush didn't complete before restart:
              │     │           Disk still has deleted conversation
              │     │
              │     └─ return Array.from(conversations.values()) [line 229]
              │        ← Backend returns all conversations including deleted one
              │
              ├─ const deletedIds = getDeletedIds() [line 94]
              │  └─ sessionStorage.getItem('channelSync:deletedIds') → null
              │     ❌ PROBLEM #2: Deleted ID is forgotten
              │
              └─ for (const conv of data.conversations) [line 97]
                 ├─ if (deletedIds.has(taskId)) continue
                 │  ← FALSE because deletedIds is empty!
                 │
                 ├─ const existing = await getTask(taskId) [line 103]
                 │  └─ SELECT * FROM tasks WHERE id = ?
                 │     → null (task was deleted)
                 │
                 ├─ if (!existing) { ← TRUE
                 │  └─ createTask({...}) [line 118]
                 │     └─ INSERT INTO tasks
                 │        🔴 TASK IS RECREATED IN LOCAL DB
                 │
                 ├─ changed = true [line 134]
                 │
                 └─ if (changed) onNewTask?.() [line 177]
                    └─ Home.tsx: loadTasks()
                       └─ setTasks([...]) 
                          🔴 TASK REAPPEARS IN UI
```

---

## File Locations & Key Functions

### Frontend (React)

#### `src/app/pages/Home.tsx`
| Line | Function | Purpose |
|------|----------|---------|
| 82-89 | `loadTasks()` | Fetch all tasks from local DB and update state |
| 102-113 | `handleDeleteTask(taskId)` | Delete task: local DB + backend + UI |
| 108 | `fetch(DELETE /channels/conversations/{taskId})` | 🔴 NOT AWAITED |

#### `src/components/layout/left-sidebar.tsx`
| Line | Function | Purpose |
|------|----------|---------|
| 164-173 | `handleConfirmDelete()` | Confirm deletion dialog handler |
| 382 | Menu item: Delete | Triggers deleteClick |

#### `src/shared/hooks/useChannelSync.ts`
| Line | Function | Purpose |
|------|----------|---------|
| 48 | `DELETED_KEY` | sessionStorage key (🔴 volatile) |
| 50-57 | `getDeletedIds()` | Retrieves deleted task IDs |
| 68-70 | `markChannelTaskDeleted(id)` | Stores deleted ID |
| 76-184 | `syncOnce()` | Main sync loop (every 3s) |
| 94 | `getDeletedIds()` | Checks if task was deleted |
| 103 | `await getTask(taskId)` | Checks if already in local DB |
| 118-122 | `await createTask()` | Creates task if missing |

#### `src/shared/db/database.ts`
| Line | Function | Purpose |
|------|----------|---------|
| 362-385 | `getAllTasks()` | Load all tasks from SQLite/IndexedDB |
| 465-482 | `deleteTask(id)` | Delete task from local DB |

### Backend (API/Sidecar)

#### `src-api/src/app/api/channels.ts`
| Line | Function | Purpose |
|------|----------|---------|
| 95-102 | `GET /channels/conversations/all` | Returns all channel conversations |
| 125-129 | `DELETE /channels/conversations/:id` | Deletes a conversation |

#### `src-api/src/shared/services/channel-store.ts`
| Line | Function | Purpose |
|------|----------|---------|
| 47-53 | `getPersistPath()` | Returns ~/.htclaw/channel-conversations.json |
| 55-88 | `loadFromDisk()` | Load conversations from disk on startup |
| 90-98 | `schedulePersist()` | Schedule disk write with 2s debounce |
| 100-110 | `flushToDisk()` | Write conversations to disk |
| 114 | `const conversations` | In-memory Map of all conversations |
| 147-213 | `appendOrCreateConversation()` | Add/update conversation when message received |
| 222-226 | `getUnsyncedConversations()` | Get conversations not yet synced to frontend |
| 228-232 | `getAllChannelConversations()` | Get all conversations (used by frontend polling) |
| 235-248 | `deleteConversation(id)` | Delete conversation from in-memory + schedule persist |

---

## Data Flow: Persistence Layers

### Frontend
```
Local State (React)
    ↓
    ├─ IndexedDB (Browser mode)
    │  ├─ Object Store: tasks
    │  ├─ Object Store: sessions
    │  └─ Object Store: messages
    │
    └─ SQLite (Tauri mode)
       ├─ Table: tasks
       ├─ Table: sessions
       └─ Table: messages
```

### Backend
```
In-Memory State (Node.js)
    ├─ conversations: Map<id, ChannelConversation>
    ├─ activeConvByChannel: Map<channel, convId>
    └─ (2s debounce flush)
           ↓
    ~/.htclaw/channel-conversations.json
    (JSON file on disk)
           ↓
    (On startup)
           ↓
    Reload into in-memory Map
```

### Session/Context Storage (Backend)
```
~/.htclaw/sessions/{sessionId}.json
├─ Full message history
├─ Compaction summary
└─ Metadata
```

---

## The 3-Second Sync Loop

```
┌──────────────────────────────────────┐
│   Frontend: useChannelSync.ts        │
│   Every 3 seconds via setInterval    │
└──────────────────────────────────────┘
        ↓
┌──────────────────────────────────────┐
│   GET /channels/conversations/all    │
│   Returns: ChannelConversation[]     │
└──────────────────────────────────────┘
        ↓
┌──────────────────────────────────────┐
│   For each conversation:             │
│   1. Check sessionStorage.deletedIds │
│   2. Check local DB (getTask)        │
│   3. If missing in both → CREATE     │
└──────────────────────────────────────┘
        ↓
┌──────────────────────────────────────┐
│   onNewTask() callback fires         │
│   → Home.tsx loadTasks()             │
│   → setState(tasks)                  │
│   → UI re-renders with new task      │
└──────────────────────────────────────┘
```

---

## Environment Detection

```typescript
// database.ts:18
function isTauriSync(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTauriInternals = '__TAURI_INTERNALS__' in window;
  const hasTauri = '__TAURI__' in window;
  return hasTauriInternals || hasTauri;
}
```

### If Tauri (Desktop App)
- Uses SQLite via `@tauri-apps/plugin-sql`
- Persistent storage in `~/.htclaw/htclaw.db`
- File-based channel conversations

### If Browser
- Uses IndexedDB
- In-memory channel store (lost on refresh)
- Volatile sessionStorage (lost on close)

---

## The Bug In These Terms

| Stage | Frontend | Backend |
|-------|----------|---------|
| **Before Delete** | `tasks = [task1, task2]` | `conversations = {id1: conv1, id2: conv2}` |
| **Delete Action** | `sessionStorage.deletedIds += id1` | `await fetch(DELETE)` (not awaited!) |
| **After Delete (Same Session)** | `sessionStorage.deletedIds = {id1}` | `conversations = {id2: conv2}` (if DELETE succeeded) |
| **App Restart** | `sessionStorage.deletedIds = {}` ← CLEARED | `conversations = {id1, id2}` (loaded from disk) |
| **First Poll** | `deletedIds.has(id1) = false` ← FORGOTTEN | `returns [conv1, conv2]` |
| **Bug Triggers** | `createTask(id1)` ← RECREATED | (still has conversation) |

