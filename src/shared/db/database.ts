import type {
  CreateFileInput,
  CreateMessageInput,
  CreateSessionInput,
  CreateTaskInput,
  LibraryFile,
  Message,
  Session,
  Task,
  UpdateTaskInput,
} from './types';
import {
  markSessionDeleted,
  markSessionDirty,
} from '@/shared/sync/session-dirty-queue';

const SQLITE_DB_NAME = 'sqlite:sage.db';
const IDB_NAME = 'sage';
const IDB_VERSION = 2; // Bump version for sessions support

// Check if running in Tauri environment synchronously
function isTauriSync(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check for Tauri v2 internals
  const hasTauriInternals = '__TAURI_INTERNALS__' in window;
  // Check for legacy Tauri v1
  const hasTauri = '__TAURI__' in window;

  return hasTauriInternals || hasTauri;
}

// ============ IndexedDB for Browser Mode ============
let idb: IDBDatabase | null = null;

async function getIndexedDB(): Promise<IDBDatabase> {
  if (idb) return idb;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onerror = () => {
      console.error('[IDB] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      idb = request.result;
      console.log('[IDB] Database opened successfully');
      resolve(idb);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      console.log('[IDB] Upgrading database...');

      // Create sessions store (v2)
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionsStore = db.createObjectStore('sessions', {
          keyPath: 'id',
        });
        sessionsStore.createIndex('created_at', 'created_at', {
          unique: false,
        });
      }

      // Create tasks store
      if (!db.objectStoreNames.contains('tasks')) {
        const tasksStore = db.createObjectStore('tasks', { keyPath: 'id' });
        tasksStore.createIndex('created_at', 'created_at', { unique: false });
        tasksStore.createIndex('session_id', 'session_id', { unique: false });
      }

      // Create messages store
      if (!db.objectStoreNames.contains('messages')) {
        const messagesStore = db.createObjectStore('messages', {
          keyPath: 'id',
          autoIncrement: true,
        });
        messagesStore.createIndex('task_id', 'task_id', { unique: false });
      }

      // Create files store
      if (!db.objectStoreNames.contains('files')) {
        const filesStore = db.createObjectStore('files', {
          keyPath: 'id',
          autoIncrement: true,
        });
        filesStore.createIndex('task_id', 'task_id', { unique: false });
      }

      console.log('[IDB] Database upgraded successfully');
    };
  });
}

// Helper to promisify IDB requests
function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============ Tauri SQLite ============
let sqliteDb: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
> | null = null;

async function getSQLiteDatabase() {
  if (!isTauriSync()) {
    return null;
  }

  if (!sqliteDb) {
    try {
      const Database = (await import('@tauri-apps/plugin-sql')).default;
      sqliteDb = await Database.load(SQLITE_DB_NAME);
      console.log('[SQLite] Database connected successfully');
    } catch (error) {
      console.error('[SQLite] Failed to connect:', error);
      return null;
    }
  }
  return sqliteDb;
}

// ============ Session Operations ============
export async function createSession(
  input: CreateSessionInput
): Promise<Session> {
  const now = new Date().toISOString();
  const session: Session = {
    id: input.id,
    prompt: input.prompt,
    task_count: 0,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();

  if (database) {
    // SQLite (Tauri) - sessions table may not exist in older DBs
    try {
      await database.execute(
        'INSERT INTO sessions (id, prompt, task_count) VALUES ($1, $2, $3)',
        [input.id, input.prompt, 0]
      );
    } catch {
      // If sessions table doesn't exist, create it first
      await database.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY NOT NULL,
          prompt TEXT NOT NULL,
          task_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await database.execute(
        'INSERT INTO sessions (id, prompt, task_count) VALUES ($1, $2, $3)',
        [input.id, input.prompt, 0]
      );
    }
    markSessionDirty(input.id);
    return session;
  } else {
    // IndexedDB (Browser)
    const db = await getIndexedDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    await idbRequest(store.put(session));
    console.log('[IDB] Created session:', input.id);
    markSessionDirty(input.id);
    return session;
  }
}

export async function getSession(id: string): Promise<Session | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      const result = await database.select<Session[]>(
        'SELECT * FROM sessions WHERE id = $1',
        [id]
      );
      return result[0] || null;
    } catch {
      return null;
    }
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const result = await idbRequest(store.get(id));
    return result || null;
  }
}

export async function getAllSessions(): Promise<Session[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      const sessions = await database.select<Session[]>(
        'SELECT * FROM sessions ORDER BY created_at DESC'
      );
      return sessions;
    } catch {
      return [];
    }
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const sessions = await idbRequest(store.getAll());
    return sessions.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export async function updateSessionTaskCount(
  sessionId: string,
  taskCount: number
): Promise<void> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      await database.execute(
        "UPDATE sessions SET task_count = $1, updated_at = datetime('now') WHERE id = $2",
        [taskCount, sessionId]
      );
    } catch {
      // Session table may not exist
    }
  } else {
    const db = await getIndexedDB();
    const session = await getSession(sessionId);
    if (session) {
      const updatedSession = {
        ...session,
        task_count: taskCount,
        updated_at: new Date().toISOString(),
      };
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      await idbRequest(store.put(updatedSession));
    }
  }
  markSessionDirty(sessionId);
}

export async function getTasksBySessionId(sessionId: string): Promise<Task[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      const tasks = await database.select<Task[]>(
        'SELECT * FROM tasks WHERE session_id = $1 ORDER BY task_index ASC',
        [sessionId]
      );
      // Convert favorite from 0/1 to boolean for all tasks
      return tasks.map((task) => ({
        ...task,
        favorite: task.favorite !== undefined ? Boolean(task.favorite) : false,
      }));
    } catch {
      // session_id column may not exist in older DBs
      return [];
    }
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    try {
      const index = store.index('session_id');
      const tasks = await idbRequest(index.getAll(sessionId));
      return tasks.sort((a, b) => (a.task_index || 0) - (b.task_index || 0));
    } catch {
      // Index may not exist
      return [];
    }
  }
}

// ============ Task Operations ============
export async function createTask(input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: input.id,
    session_id: input.session_id,
    task_index: input.task_index,
    prompt: input.prompt,
    status: 'running',
    cost: null,
    duration: null,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();

  if (database) {
    // SQLite (Tauri) - Try with new schema, fallback to old
    try {
      await database.execute(
        'INSERT INTO tasks (id, session_id, task_index, prompt) VALUES ($1, $2, $3, $4)',
        [input.id, input.session_id, input.task_index, input.prompt]
      );
    } catch {
      // Fallback for older schema without session_id
      await database.execute('INSERT INTO tasks (id, prompt) VALUES ($1, $2)', [
        input.id,
        input.prompt,
      ]);
    }
    const result = await getTask(input.id);
    if (!result) throw new Error('Failed to create task');

    // Update session task count
    await updateSessionTaskCount(input.session_id, input.task_index);

    return result;
  } else {
    // IndexedDB (Browser)
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await idbRequest(store.put(task));
    console.log('[IDB] Created task:', input.id);

    // Update session task count
    await updateSessionTaskCount(input.session_id, input.task_index);

    return task;
  }
}

export async function getTask(id: string): Promise<Task | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.select<Task[]>(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    const task = result[0] || null;
    // Convert favorite from 0/1 to boolean
    if (task && task.favorite !== undefined) {
      task.favorite = Boolean(task.favorite);
    }
    return task;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const result = await idbRequest(store.get(id));
    return result || null;
  }
}

export async function getAllTasks(): Promise<Task[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    const tasks = await database.select<Task[]>(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    );
    // Convert favorite from 0/1 to boolean for all tasks
    return tasks.map((task) => ({
      ...task,
      favorite: task.favorite !== undefined ? Boolean(task.favorite) : false,
    }));
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const tasks = await idbRequest(store.getAll());
    // Sort by created_at descending
    return tasks.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput
): Promise<Task | null> {
  const database = await getSQLiteDatabase();

  let result: Task | null;
  if (database) {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let paramIndex = 1;

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.cost !== undefined) {
      updates.push(`cost = $${paramIndex++}`);
      values.push(input.cost);
    }
    if (input.duration !== undefined) {
      updates.push(`duration = $${paramIndex++}`);
      values.push(input.duration);
    }
    if (input.prompt !== undefined) {
      updates.push(`prompt = $${paramIndex++}`);
      values.push(input.prompt);
    }
    if (input.favorite !== undefined) {
      updates.push(`favorite = $${paramIndex++}`);
      values.push(input.favorite ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = datetime('now')`);
      values.push(id);
      try {
        await database.execute(
          `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        );
      } catch (error) {
        // If favorite column doesn't exist, add it and retry
        if (
          input.favorite !== undefined &&
          String(error).includes('favorite')
        ) {
          await database.execute(
            'ALTER TABLE tasks ADD COLUMN favorite INTEGER DEFAULT 0'
          );
          await database.execute(
            `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
          );
        } else {
          throw error;
        }
      }
    }

    result = await getTask(id);
  } else {
    const db = await getIndexedDB();
    const task = await getTask(id);
    if (task) {
      const updatedTask = {
        ...task,
        ...input,
        updated_at: new Date().toISOString(),
      };
      const tx = db.transaction('tasks', 'readwrite');
      const store = tx.objectStore('tasks');
      await idbRequest(store.put(updatedTask));
      result = updatedTask;
    } else {
      result = null;
    }
  }

  // 影响 session 的只有 prompt（title 来源）和 status（间接通过 preview 不变，但语义上是活跃）
  if (result?.session_id) {
    markSessionDirty(result.session_id);
  }

  return result;
}

export async function deleteTask(id: string): Promise<boolean> {
  const database = await getSQLiteDatabase();

  // 先记下 session_id，删除前拿到，删除后用它来更新 task_count / 判断是否清空 session
  const task = await getTask(id);
  const sessionId = task?.session_id ?? null;

  let ok: boolean;
  if (database) {
    const result = await database.execute('DELETE FROM tasks WHERE id = $1', [
      id,
    ]);
    ok = result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await idbRequest(store.delete(id));
    // Also delete related messages
    await deleteMessagesByTaskId(id);
    ok = true;
  }

  // Refresh parent session：若 session 还剩 task 则 markDirty，否则 markDeleted
  if (ok && sessionId) {
    try {
      const remaining = await getTasksBySessionId(sessionId);
      if (remaining.length === 0) {
        markSessionDeleted(sessionId);
      } else {
        markSessionDirty(sessionId);
      }
    } catch {
      /* best effort */
    }
  }

  return ok;
}

// ============ Message Operations ============
export async function createMessage(
  input: CreateMessageInput
): Promise<Message> {
  const now = new Date().toISOString();
  const database = await getSQLiteDatabase();

  let created: Message;

  if (database) {
    // Try with attachments column first, fallback to without
    try {
      const result = await database.execute(
        `INSERT INTO messages (task_id, type, content, tool_name, tool_input, tool_output, tool_use_id, subtype, error_message, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.task_id,
          input.type,
          input.content || null,
          input.tool_name || null,
          input.tool_input || null,
          input.tool_output || null,
          input.tool_use_id || null,
          input.subtype || null,
          input.error_message || null,
          input.attachments || null,
        ]
      );

      const messages = await database.select<Message[]>(
        'SELECT * FROM messages WHERE id = $1',
        [result.lastInsertId]
      );
      created = messages[0];
    } catch {
      // Fallback: add attachments column if it doesn't exist
      try {
        await database.execute(
          'ALTER TABLE messages ADD COLUMN attachments TEXT'
        );
      } catch {
        // Column may already exist
      }

      const result = await database.execute(
        `INSERT INTO messages (task_id, type, content, tool_name, tool_input, tool_output, tool_use_id, subtype, error_message, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.task_id,
          input.type,
          input.content || null,
          input.tool_name || null,
          input.tool_input || null,
          input.tool_output || null,
          input.tool_use_id || null,
          input.subtype || null,
          input.error_message || null,
          input.attachments || null,
        ]
      );

      const messages = await database.select<Message[]>(
        'SELECT * FROM messages WHERE id = $1',
        [result.lastInsertId]
      );
      created = messages[0];
    }
  } else {
    const db = await getIndexedDB();
    const message: Omit<Message, 'id'> & { id?: number } = {
      task_id: input.task_id,
      type: input.type,
      content: input.content || null,
      tool_name: input.tool_name || null,
      tool_input: input.tool_input || null,
      tool_output: input.tool_output || null,
      tool_use_id: input.tool_use_id || null,
      subtype: input.subtype || null,
      error_message: input.error_message || null,
      attachments: input.attachments || null,
      created_at: now,
    };

    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const id = await idbRequest(store.add(message));
    created = { ...message, id: id as number } as Message;
  }

  // Mark parent session dirty (preview / message_count / updated_at 都可能变)
  try {
    const task = await getTask(input.task_id);
    if (task?.session_id) markSessionDirty(task.session_id);
  } catch {
    /* best effort */
  }

  return created;
}

export async function getMessagesByTaskId(taskId: string): Promise<Message[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    return database.select<Message[]>(
      'SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('task_id');
    const messages = await idbRequest(index.getAll(taskId));
    return messages.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }
}

export async function deleteMessagesByTaskId(taskId: string): Promise<number> {
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.execute(
      'DELETE FROM messages WHERE task_id = $1',
      [taskId]
    );
    return result.rowsAffected;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const index = store.index('task_id');
    const messages = await idbRequest(index.getAll(taskId));

    for (const message of messages) {
      await idbRequest(store.delete(message.id));
    }
    return messages.length;
  }
}

// Helper function to update task status based on message type
export async function updateTaskFromMessage(
  taskId: string,
  messageType: string,
  subtype?: string,
  cost?: number,
  duration?: number
): Promise<void> {
  if (messageType === 'result') {
    // Only mark as completed for actual success
    // error_max_turns means the task was interrupted, not completed
    // Keep it in 'running' state so user knows to continue
    if (subtype === 'success') {
      await updateTask(taskId, { status: 'completed', cost, duration });
    } else if (subtype === 'error_max_turns') {
      // Task hit max turns limit - keep as running, just update cost/duration
      await updateTask(taskId, { cost, duration });
      console.log(
        `[Database] Task ${taskId} hit max turns limit, keeping as running`
      );
    } else {
      // Other errors
      await updateTask(taskId, { status: 'error', cost, duration });
    }
  } else if (messageType === 'error') {
    await updateTask(taskId, { status: 'error' });
  }
}

// Export utility to check environment
export function isDatabaseAvailable(): boolean {
  return isTauriSync();
}

// ============ Library File Operations ============
export async function createFile(input: CreateFileInput): Promise<LibraryFile> {
  const now = new Date().toISOString();
  const database = await getSQLiteDatabase();

  let file: LibraryFile;
  if (database) {
    const result = await database.execute(
      `INSERT INTO files (task_id, name, type, path, preview, thumbnail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.task_id,
        input.name,
        input.type,
        input.path,
        input.preview || null,
        input.thumbnail || null,
      ]
    );

    const files = await database.select<LibraryFile[]>(
      'SELECT * FROM files WHERE id = $1',
      [result.lastInsertId]
    );
    file = files[0];
  } else {
    const db = await getIndexedDB();
    const newFile: Omit<LibraryFile, 'id'> & { id?: number } = {
      task_id: input.task_id,
      name: input.name,
      type: input.type,
      path: input.path,
      preview: input.preview || null,
      thumbnail: input.thumbnail || null,
      is_favorite: false,
      created_at: now,
    };

    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const id = await idbRequest(store.add(newFile));
    file = { ...newFile, id: id as number } as LibraryFile;
  }

  // 新增 file 会让 session 的 has_artifacts 变成 true
  try {
    const task = await getTask(input.task_id);
    if (task?.session_id) markSessionDirty(task.session_id);
  } catch {
    /* best effort */
  }

  return file;
}

export async function getFilesByTaskId(taskId: string): Promise<LibraryFile[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    return database.select<LibraryFile[]>(
      'SELECT * FROM files WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const index = store.index('task_id');
    const files = await idbRequest(index.getAll(taskId));
    return files.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }
}

export async function getAllFiles(): Promise<LibraryFile[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    return database.select<LibraryFile[]>(
      'SELECT * FROM files ORDER BY created_at DESC'
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const files = await idbRequest(store.getAll());
    return files.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export async function toggleFileFavorite(
  fileId: number
): Promise<LibraryFile | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    await database.execute(
      'UPDATE files SET is_favorite = NOT is_favorite WHERE id = $1',
      [fileId]
    );
    const files = await database.select<LibraryFile[]>(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );
    return files[0] || null;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const file = await idbRequest(store.get(fileId));
    if (file) {
      file.is_favorite = !file.is_favorite;
      await idbRequest(store.put(file));
      return file;
    }
    return null;
  }
}

export async function deleteFile(fileId: number): Promise<boolean> {
  const database = await getSQLiteDatabase();

  // 删除前记下 task_id，用于刷新对应 session 的 has_artifacts
  let taskId: string | null = null;
  try {
    if (database) {
      const rows = await database.select<{ task_id: string }[]>(
        'SELECT task_id FROM files WHERE id = $1',
        [fileId]
      );
      taskId = rows[0]?.task_id ?? null;
    } else {
      const db = await getIndexedDB();
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const file = await idbRequest(store.get(fileId));
      taskId = file?.task_id ?? null;
    }
  } catch {
    /* best effort */
  }

  let ok: boolean;
  if (database) {
    const result = await database.execute('DELETE FROM files WHERE id = $1', [
      fileId,
    ]);
    ok = result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    await idbRequest(store.delete(fileId));
    ok = true;
  }

  if (ok && taskId) {
    try {
      const task = await getTask(taskId);
      if (task?.session_id) markSessionDirty(task.session_id);
    } catch {
      /* best effort */
    }
  }

  return ok;
}

// Get files grouped by task with task info
export async function getFilesGroupedByTask(): Promise<
  { task: Task; files: LibraryFile[] }[]
> {
  const allFiles = await getAllFiles();
  const allTasks = await getAllTasks();

  // Create a map of task_id to files
  const filesByTask = new Map<string, LibraryFile[]>();
  for (const file of allFiles) {
    const existing = filesByTask.get(file.task_id) || [];
    existing.push(file);
    filesByTask.set(file.task_id, existing);
  }

  // Build result with task info
  const result: { task: Task; files: LibraryFile[] }[] = [];
  for (const task of allTasks) {
    const files = filesByTask.get(task.id);
    if (files && files.length > 0) {
      result.push({ task, files });
    }
  }

  return result;
}
