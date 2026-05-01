import {
  ensureUserDirs,
  getUserDbConnString,
} from '@/shared/lib/user-scoped-paths';
import { enqueueMessageInsert } from '@/shared/sync/messages-sync';
import { enqueueUserBehavior } from '@/shared/sync/behavior-sync';
import {
  markSessionDeleted,
  markSessionDirty,
} from '@/shared/sync/session-dirty-queue';
import { uuidv7 } from 'uuidv7';

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

// ─── User-scoped DB binding ──────────────────────────────────────────────────
//
// M1 —— 按账号隔离本地数据。
//
// 核心变化：
//   - 不再使用固定的 `sqlite:sage.db` 连接（那是 Rust 端 migrations 注册的路径，
//     位于 ~/Library/Application Support/ai.sage.desktop/sage.db）。
//   - 改为按 user.id 懒加载 `sqlite:~/.sage/users/{uid}/sage.db`。
//   - Rust 端 migrations 不会对这些动态路径生效，所以 schema 由 JS 端的
//     `ensureSchema()` 幂等建表负责。
//
// bind/unbind 时序：
//   - AuthProvider 在 getSession() resolve / SIGNED_IN / TOKEN_REFRESHED /
//     超时兜底解析 JWT 成功时调 `bindUserId(uid)`。
//   - AuthProvider 在 SIGNED_OUT / 显式登出 时调 `unbindUser()`。
//   - 切换用户（A 登出 → B 登录）：unbindUser 关闭旧连接，bindUserId 打开新连接。
//
// 并发保护：
//   - 使用 inFlight Promise 串行化 bind/unbind，避免两个 auth 事件同时触发
//     竞争关闭/打开。
//   - getSQLiteDatabase() 在未 bind 时返回 null（与浏览器模式行为一致）。

const IDB_NAME = 'sage';
// v3: Phase 1 - messages/files 主键从 autoIncrement 改为客户端生成的 UUID v7（跨设备唯一）
//     已与用户达成共识：内测期数据丢弃，DROP 旧 store 重建
// v4: Phase 1 - 新增 sync_queue store（本地→云端双写失败的重试队列）
const IDB_VERSION = 4;

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
      const oldVersion = event.oldVersion;
      console.log(
        `[IDB] Upgrading database from v${oldVersion} to v${IDB_VERSION}...`
      );

      // sessions store (v2 起)
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionsStore = db.createObjectStore('sessions', {
          keyPath: 'id',
        });
        sessionsStore.createIndex('created_at', 'created_at', {
          unique: false,
        });
      }

      // tasks store
      if (!db.objectStoreNames.contains('tasks')) {
        const tasksStore = db.createObjectStore('tasks', { keyPath: 'id' });
        tasksStore.createIndex('created_at', 'created_at', { unique: false });
        tasksStore.createIndex('session_id', 'session_id', { unique: false });
      }

      // messages store
      // v3 破坏性变更：autoIncrement INTEGER → UUID v7 字符串
      // 老 store 的数据不兼容新主键，直接删除重建
      if (oldVersion < 3 && db.objectStoreNames.contains('messages')) {
        db.deleteObjectStore('messages');
        console.log(
          '[IDB] v3 migration: dropped old messages store (autoIncrement)'
        );
      }
      if (!db.objectStoreNames.contains('messages')) {
        const messagesStore = db.createObjectStore('messages', {
          keyPath: 'id',
        });
        messagesStore.createIndex('task_id', 'task_id', { unique: false });
        messagesStore.createIndex('user_id', 'user_id', { unique: false });
        messagesStore.createIndex('updated_at', 'updated_at', {
          unique: false,
        });
      }

      // files store - 同 messages 处理
      if (oldVersion < 3 && db.objectStoreNames.contains('files')) {
        db.deleteObjectStore('files');
        console.log(
          '[IDB] v3 migration: dropped old files store (autoIncrement)'
        );
      }
      if (!db.objectStoreNames.contains('files')) {
        const filesStore = db.createObjectStore('files', {
          keyPath: 'id',
        });
        filesStore.createIndex('task_id', 'task_id', { unique: false });
        filesStore.createIndex('user_id', 'user_id', { unique: false });
        filesStore.createIndex('updated_at', 'updated_at', { unique: false });
      }

      // sync_queue store (v4)
      if (!db.objectStoreNames.contains('sync_queue')) {
        const syncQueueStore = db.createObjectStore('sync_queue', {
          keyPath: 'id',
        });
        syncQueueStore.createIndex('next_retry_at', 'next_retry_at', {
          unique: false,
        });
        syncQueueStore.createIndex('user_id', 'user_id', { unique: false });
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
type SqliteHandle = Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
>;

let sqliteDb: SqliteHandle | null = null;
let currentUid: string | null = null;
let bindInFlight: Promise<void> | null = null;
// 监听器：供 settings 缓存失效 / UI 重新查询使用
const bindListeners = new Set<(uid: string | null) => void>();

/**
 * 订阅 user binding 变化。
 * 回调参数：新的 uid（null 表示已 unbind）。
 * 触发时机：bindUserId / unbindUser 成功完成之后。
 */
export function subscribeUserBinding(
  cb: (uid: string | null) => void
): () => void {
  bindListeners.add(cb);
  return () => {
    bindListeners.delete(cb);
  };
}

function notifyBindChange() {
  for (const cb of bindListeners) {
    try {
      cb(currentUid);
    } catch (err) {
      console.error('[DB] bind listener error:', err);
    }
  }
}

/**
 * 获取当前绑定的 user id（未绑定时为 null）。
 * 用于 useAgent 等需要推导用户作用域路径的地方。
 */
export function getCurrentBoundUid(): string | null {
  return currentUid;
}

/**
 * 幂等建表。把 src-tauri/src/lib.rs 中 7 条 migrations 平展成
 * `CREATE TABLE IF NOT EXISTS` + 缺列时的 `ALTER TABLE`。
 *
 * 这个函数每次 bind 都跑一次，成本小，保证空 DB 也能用。
 */
/**
 * 检测某张表的某个列是否为指定类型（PRAGMA table_info）。
 * 用于判断 messages.id / files.id 是否还是老的 INTEGER schema。
 */
async function columnHasType(
  db: SqliteHandle,
  table: string,
  column: string,
  expectedType: string
): Promise<boolean> {
  try {
    const rows = await db.select<{ name: string; type: string }[]>(
      `PRAGMA table_info(${table})`
    );
    const col = rows.find((r) => r.name === column);
    return col?.type.toUpperCase() === expectedType.toUpperCase();
  } catch {
    return false;
  }
}

async function ensureSchema(db: SqliteHandle): Promise<void> {
  // tasks（合并 v1 + v5 + v7：session_id / task_index / favorite）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      cost REAL,
      duration INTEGER,
      session_id TEXT,
      task_index INTEGER DEFAULT 1,
      favorite INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ─── Phase 1 破坏性升级：messages.id INTEGER → TEXT (UUID v7) ────────────
  // 检测老 schema 并 DROP；内测期数据丢弃（用户已确认）
  if (await columnHasType(db, 'messages', 'id', 'INTEGER')) {
    console.warn(
      '[DB] Phase 1 migration: dropping legacy messages table (autoincrement INTEGER → UUID v7)'
    );
    await db.execute('DROP TABLE IF EXISTS messages');
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      tool_use_id TEXT,
      tool_metadata TEXT,
      subtype TEXT,
      error_message TEXT,
      attachments TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  // ─── Phase 1 破坏性升级：files.id INTEGER → TEXT (UUID v7) ────────────
  if (await columnHasType(db, 'files', 'id', 'INTEGER')) {
    console.warn(
      '[DB] Phase 1 migration: dropping legacy files table (autoincrement INTEGER → UUID v7)'
    );
    await db.execute('DROP TABLE IF EXISTS files');
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      preview TEXT,
      thumbnail TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  // settings（v4）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // sessions（v5）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      prompt TEXT NOT NULL,
      task_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // sync_queue（Phase 1）：本地→云端双写失败时的重试队列
  // 表设计为通用，未来扩展 tasks/files 同步无需改 schema
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Indexes
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_messages_user_updated ON messages(user_id, updated_at DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_files_task_id ON files(task_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_files_user_updated ON files(user_id, updated_at DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at)`
  );

  // 迁移过来的旧 DB 可能缺列（仅 tasks 现在还需要 ALTER；messages/files 已 DROP 重建）
  const alters = [
    'ALTER TABLE tasks ADD COLUMN session_id TEXT',
    'ALTER TABLE tasks ADD COLUMN task_index INTEGER DEFAULT 1',
    'ALTER TABLE tasks ADD COLUMN favorite INTEGER DEFAULT 0',
  ];
  for (const sql of alters) {
    try {
      await db.execute(sql);
    } catch {
      /* column already exists */
    }
  }
}

/**
 * 绑定指定 uid 的 DB 连接。
 *
 * 幂等：若当前已绑定相同 uid，则 no-op。
 * 并发安全：同时多次调用会串行执行。
 *
 * 抛错时机：
 *   - uid 非法 UUID
 *   - Tauri fs/sql 插件不可用
 */
export async function bindUserId(uid: string): Promise<void> {
  // IDB 模式（iOS / 浏览器）也要 track 当前 uid，让 createMessage 等能注入 user_id
  if (!isTauriSync()) {
    currentUid = uid;
    notifyBindChange();
    return;
  }

  // 串行化：等待任何 in-flight bind/unbind 先完成
  if (bindInFlight) {
    await bindInFlight.catch(() => {});
  }

  if (sqliteDb && currentUid === uid) {
    return; // 已绑定到同一 uid
  }

  bindInFlight = (async () => {
    // 1. 关闭旧连接（若有）
    if (sqliteDb) {
      try {
        await sqliteDb.close();
      } catch (err) {
        console.warn('[DB] close old connection failed:', err);
      }
      sqliteDb = null;
    }

    // 2. 确保目录 + 解析新连接串
    await ensureUserDirs(uid);
    const connStr = await getUserDbConnString(uid);

    // 3. 一次性迁移 legacy 数据（仅第一次绑定触发；见 user-scope-migration.ts）
    //    在打开连接之前 copy DB 文件，避免 sqlx 持有旧文件的锁
    try {
      const { maybeMigrateLegacyData } =
        await import('@/shared/lib/user-scope-migration');
      await maybeMigrateLegacyData(uid);
    } catch (err) {
      // 迁移失败不应阻塞登录 —— 用户至少能使用空 DB
      console.error('[DB] legacy migration failed (continuing):', err);
    }

    // 4. 打开新连接 + 幂等建表
    const Database = (await import('@tauri-apps/plugin-sql')).default;
    const db = await Database.load(connStr);
    await ensureSchema(db);

    sqliteDb = db;
    currentUid = uid;
    console.log(
      `[DB] bound to user ${uid.slice(0, 8)}… at ${connStr.replace(/^sqlite:/, '')}`
    );
  })();

  try {
    await bindInFlight;
  } finally {
    bindInFlight = null;
  }

  notifyBindChange();
}

/**
 * 解除 user 绑定。关闭当前连接，后续 `getSQLiteDatabase()` 返回 null。
 * 用于登出流程。
 */
export async function unbindUser(): Promise<void> {
  if (!isTauriSync()) {
    currentUid = null;
    notifyBindChange();
    return;
  }

  if (bindInFlight) {
    await bindInFlight.catch(() => {});
  }

  bindInFlight = (async () => {
    if (sqliteDb) {
      try {
        await sqliteDb.close();
      } catch (err) {
        console.warn('[DB] close on unbind failed:', err);
      }
      sqliteDb = null;
    }
    currentUid = null;
  })();

  try {
    await bindInFlight;
  } finally {
    bindInFlight = null;
  }

  notifyBindChange();
}

export async function getSQLiteDatabase() {
  if (!isTauriSync()) {
    return null;
  }

  // 等待任何 in-flight bind/unbind 先完成
  if (bindInFlight) {
    try {
      await bindInFlight;
    } catch {
      /* 失败不在这里抛，返回 null 让调用方走浏览器/空数据路径 */
    }
  }

  // 未绑定 user → 返回 null（调用方已有 null-handling）
  if (!currentUid || !sqliteDb) {
    return null;
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
  // Phase 1: 客户端生成 UUID v7，作为本地 + 云端共用的全局唯一 id
  // 跨设备同步时无需 ID 映射，对索引友好（时间戳前缀使 B-tree 顺序写入）
  const id = uuidv7();
  const now = new Date().toISOString();

  // user_id 必须存在 —— 双写云端时 RLS 用它隔离
  const userId = currentUid;
  if (!userId) {
    throw new Error(
      '[DB] createMessage called without bound user. AuthProvider must bindUserId() before any DB ops.'
    );
  }

  const message: Message = {
    id,
    user_id: userId,
    task_id: input.task_id,
    type: input.type,
    content: input.content ?? null,
    tool_name: input.tool_name ?? null,
    tool_input: input.tool_input ?? null,
    tool_output: input.tool_output ?? null,
    tool_use_id: input.tool_use_id ?? null,
    tool_metadata: input.tool_metadata ?? null,
    subtype: input.subtype ?? null,
    error_message: input.error_message ?? null,
    attachments: input.attachments ?? null,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();

  if (database) {
    await database.execute(
      `INSERT INTO messages
       (id, user_id, task_id, type, content, tool_name, tool_input, tool_output,
        tool_use_id, tool_metadata, subtype, error_message, attachments, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        message.id,
        message.user_id,
        message.task_id,
        message.type,
        message.content,
        message.tool_name,
        message.tool_input,
        message.tool_output,
        message.tool_use_id,
        message.tool_metadata,
        message.subtype,
        message.error_message,
        message.attachments,
        message.created_at,
        message.updated_at,
      ]
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    await idbRequest(store.add(message));
  }

  // Phase 1: 火忘式双写，不阻塞当前调用
  enqueueMessageInsert(message);
  // Phase 4 / L4-light: user message 同步打点到 user_behavior（非 user 自动跳过）
  enqueueUserBehavior(message);

  // Mark parent session dirty (preview / message_count / updated_at 都可能变)
  try {
    const task = await getTask(input.task_id);
    if (task?.session_id) markSessionDirty(task.session_id);
  } catch {
    /* best effort */
  }

  return message;
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
  // Phase 1: files 也用 UUID v7（跨设备唯一，与 messages 一致）
  const id = uuidv7();
  const now = new Date().toISOString();

  const userId = currentUid;
  if (!userId) {
    throw new Error(
      '[DB] createFile called without bound user. AuthProvider must bindUserId() before any DB ops.'
    );
  }

  const file: LibraryFile = {
    id,
    user_id: userId,
    task_id: input.task_id,
    name: input.name,
    type: input.type,
    path: input.path,
    preview: input.preview ?? null,
    thumbnail: input.thumbnail ?? null,
    is_favorite: false,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();
  if (database) {
    await database.execute(
      `INSERT INTO files (id, user_id, task_id, name, type, path, preview, thumbnail, is_favorite, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        file.id,
        file.user_id,
        file.task_id,
        file.name,
        file.type,
        file.path,
        file.preview,
        file.thumbnail,
        file.is_favorite ? 1 : 0,
        file.created_at,
        file.updated_at,
      ]
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    await idbRequest(store.add(file));
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
  fileId: string
): Promise<LibraryFile | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    await database.execute(
      "UPDATE files SET is_favorite = NOT is_favorite, updated_at = datetime('now') WHERE id = $1",
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
      file.updated_at = new Date().toISOString();
      await idbRequest(store.put(file));
      return file;
    }
    return null;
  }
}

export async function deleteFile(fileId: string): Promise<boolean> {
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
