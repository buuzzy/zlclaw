/**
 * Legacy data migration (one-shot, v1 → v2 user-scoped).
 *
 * 背景：
 *   - v1（内测前）本地数据是全局共享的，SQLite 在
 *     `~/Library/Application Support/ai.sage.desktop/sage.db`，
 *     session 附件在 `~/.sage/sessions/<id>/attachments/...`。
 *   - v2（M1 之后）改为按账号隔离：
 *     `~/.sage/users/{uid}/sage.db` + `~/.sage/users/{uid}/sessions/*`。
 *
 * 迁移策略：
 *   - 复制（copy）而非移动（move）：保留 legacy 副本以便回退到老版本。
 *   - 只迁移一次：全局标记 `~/.sage/.user-scope-migration-v1`。
 *     第一个登录的用户"继承"legacy 数据；后续登录的用户从空 DB 起步
 *     （他们的数据应当来自云端 —— 目前 Phase 3 只单向推送，跨设备拉取是
 *     后续 LATER 条目）。
 *
 * 调用时机：
 *   - `bindUserId()` 的内部流程里，**在打开新 DB 连接之前**调用。
 *   - sqlx 对旧 DB 文件持锁，所以 copy 必须在 `Database.load(newDb)` 之前完成。
 *
 * 失败处理：
 *   - 所有异常 catch + 写到 console。迁移失败不应阻塞登录：用户至少
 *     能在空 DB 上继续使用（后续手动通过设置里的 import 补救）。
 */

import {
  getGlobalMigrationMarkerPath,
  getSageRootDir,
  getUserDataDir,
  getUserDbAbsolutePath,
  getUserSessionsDir,
} from './user-scoped-paths';

function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(p);
  } catch {
    return false;
  }
}

/**
 * 获取 v1 时代 SQLite 的绝对路径（macOS: ~/Library/Application Support/ai.sage.desktop/sage.db）。
 */
async function getLegacyDbAbsolutePath(): Promise<string | null> {
  try {
    const { appConfigDir } = await import('@tauri-apps/api/path');
    const dir = await appConfigDir();
    const clean = dir.replace(/[/\\]$/, '');
    return `${clean}/sage.db`;
  } catch (err) {
    console.warn('[migration] resolve appConfigDir failed:', err);
    return null;
  }
}

/**
 * 获取 v1 时代共享的 sessions 目录（~/.sage/sessions）。
 */
async function getLegacySessionsDir(): Promise<string> {
  const root = await getSageRootDir();
  return `${root}/sessions`;
}

async function copyFile(src: string, dst: string): Promise<void> {
  const { readFile, writeFile, mkdir } = await import('@tauri-apps/plugin-fs');

  // 确保目标目录存在
  const lastSlash = dst.lastIndexOf('/');
  if (lastSlash > 0) {
    try {
      await mkdir(dst.slice(0, lastSlash), { recursive: true });
    } catch {
      /* exists */
    }
  }

  const bytes = await readFile(src);
  await writeFile(dst, bytes);
}

/**
 * 递归复制一个目录（Tauri fs plugin 没有 copyDir，要自己遍历）。
 */
async function copyDirRecursive(src: string, dst: string): Promise<void> {
  const { readDir, mkdir } = await import('@tauri-apps/plugin-fs');

  try {
    await mkdir(dst, { recursive: true });
  } catch {
    /* exists */
  }

  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(src);
  } catch (err) {
    console.warn(`[migration] readDir ${src} failed:`, err);
    return;
  }

  for (const entry of entries) {
    const srcPath = `${src}/${entry.name}`;
    const dstPath = `${dst}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile) {
      try {
        await copyFile(srcPath, dstPath);
      } catch (err) {
        console.warn(`[migration] copy ${srcPath} -> ${dstPath} failed:`, err);
      }
    }
    // symlinks and other: skip
  }
}

/**
 * 为给定 uid 执行一次性 legacy 数据迁移（只做一次，全局标记保护）。
 *
 * 第一个登录的账号 U1 会触发 copy：
 *   legacy sage.db          → ~/.sage/users/U1/sage.db
 *   ~/.sage/sessions/*      → ~/.sage/users/U1/sessions/*
 *   ~/.sage/.user-scope-migration-v1  ← 标记写入
 *
 * 后续账号 U2 登录时看到标记存在，跳过 copy（拿到空 DB / 空 sessions 目录）。
 */
export async function maybeMigrateLegacyData(uid: string): Promise<void> {
  if (!isTauri()) return;

  const marker = await getGlobalMigrationMarkerPath();
  if (await pathExists(marker)) {
    return; // 已迁移过，跳过
  }

  // 确保用户目录存在
  const userDir = await getUserDataDir(uid);
  try {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    await mkdir(userDir, { recursive: true });
  } catch {
    /* exists */
  }

  const legacyDb = await getLegacyDbAbsolutePath();
  const newDb = await getUserDbAbsolutePath(uid);

  // 1. 迁移 SQLite
  if (legacyDb && (await pathExists(legacyDb))) {
    if (!(await pathExists(newDb))) {
      try {
        console.log(`[migration] copying legacy DB: ${legacyDb} -> ${newDb}`);
        await copyFile(legacyDb, newDb);
      } catch (err) {
        console.error('[migration] DB copy failed:', err);
      }
    }
  }

  // 2. 迁移 sessions 目录
  const legacySessions = await getLegacySessionsDir();
  const newSessions = await getUserSessionsDir(uid);
  if (await pathExists(legacySessions)) {
    try {
      console.log(
        `[migration] copying legacy sessions: ${legacySessions} -> ${newSessions}`
      );
      await copyDirRecursive(legacySessions, newSessions);
    } catch (err) {
      console.error('[migration] sessions copy failed:', err);
    }
  }

  // 3. 写入全局标记
  //
  // ⚠️ 实现备注：
  //   - 用 writeFile（binary）而非 writeTextFile（后者在某些 plugin-fs 版本下
  //     命令路径有权限问题）
  //   - marker 是隐藏文件（`.user-scope-migration-v1`）。fs scope 的 `**`
  //     默认不匹配隐藏文件，所以 capabilities/default.json 里额外加了
  //     `$HOME/.sage/.*` 规则。如果你改了 marker 名字，注意同步 scope。
  try {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const payload = JSON.stringify({
      at: new Date().toISOString(),
      claimedBy: uid,
      fromDb: legacyDb,
      fromSessions: legacySessions,
    });
    const bytes = new TextEncoder().encode(payload);
    await writeFile(marker, bytes);
    console.log(`[migration] wrote marker: ${marker}`);
  } catch (err) {
    console.error('[migration] failed to write marker:', err);
  }
}
