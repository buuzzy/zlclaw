/**
 * UpdateProvider — Phase M2 + M3
 *
 * 职责：
 *   1. 应用启动后延迟 3s 自动调一次 `check()`（M3：启动自动检查）
 *   2. 提供 hook 供 Settings > 关于 里的"检查更新"按钮使用（M2：手动检查）
 *   3. 跟踪 check / download / install 整个生命周期状态供 UI 渲染
 *
 * 为什么是 Provider 而不是一次性 hook：
 *   - M2 的检查更新按钮要共享 M3 启动时已经拿到的 Update 对象（不然两处都要 check 一次）
 *   - Banner 要能跨页面保留 dismissed 状态（否则用户切换 Settings/Home 就又弹出来）
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// ─── Types ───────────────────────────────────────────────────────────────────

export type UpdateStatus =
  | 'idle' // 尚未检查
  | 'checking' // check() 进行中
  | 'up-to-date' // 已是最新
  | 'available' // 发现新版，等待用户确认
  | 'downloading' // 正在下载
  | 'ready' // 下载完成 + 签名已校验，等待重启
  | 'installing' // install() 调用中（通常瞬间）
  | 'error'; // 任一步骤失败

export interface UpdateState {
  status: UpdateStatus;
  /** 最近一次 check 的结果（有新版时才非空） */
  update: Update | null;
  /** 新版本号（= update.version），UI 直接用 */
  latestVersion: string | null;
  /** Release notes（来自 manifest.notes），渲染详情用 */
  notes: string | null;
  /** 下载进度 0-1，未下载时为 null */
  progress: number | null;
  /** 用户已忽略这个版本号（关闭入口外层红点）—— 仅本次 app 生命周期 */
  dismissedVersion: string | null;
  /** 错误 message */
  errorMessage: string | null;
  /**
   * 用户已在此次 session 打开过 Settings > 关于 Tab（看到次级红点即视为已看到）。
   * sidebar 上的"外层"红点依此 + latestVersion 判断是否还要显示。
   * 每个新版本到来时自动 reset 为 null，让用户对"每个新版本"都至少看到一次外层红点。
   */
  aboutSeenVersion: string | null;
}

interface UpdateContextType extends UpdateState {
  /**
   * 手动触发 check。
   * M2 的"检查更新"按钮使用；启动后自动也走这里。
   * 返回 true = 有新版，false = 已是最新，抛错 = 检查失败（网络 / 签名配置）。
   */
  checkForUpdates: () => Promise<boolean>;
  /**
   * 下载并安装。成功后 app 会自动重启。
   * 仅在 status === 'available' 时有意义。
   */
  downloadAndInstall: () => Promise<void>;
  /**
   * 用户点"稍后"忽略当前 available 版本。本次 app 生命周期不再弹任何提示。
   */
  dismiss: () => void;
  /**
   * 用户打开了 Settings > 关于 Tab。
   * 调用后 sidebar 上的外层红点消失（但"关于" Tab 内部的按钮红点仍在，
   * 直到用户真正点"下载更新"或新版本号到来）。
   */
  markAboutSeen: () => void;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

// ─── Env helpers ─────────────────────────────────────────────────────────────

function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

// ─── Provider ────────────────────────────────────────────────────────────────

const STARTUP_CHECK_DELAY_MS = 3000;

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    update: null,
    latestVersion: null,
    notes: null,
    progress: null,
    dismissedVersion: null,
    errorMessage: null,
    aboutSeenVersion: null,
  });

  // 并发保护：check / download 不允许重入
  const busyRef = useRef(false);

  const checkForUpdates = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) {
      // Browser 模式下 updater plugin 不可用
      setState((s) => ({
        ...s,
        status: 'up-to-date',
        errorMessage: null,
      }));
      return false;
    }
    if (busyRef.current) {
      console.log('[updater] check skipped: busy');
      return false;
    }
    busyRef.current = true;
    setState((s) => ({ ...s, status: 'checking', errorMessage: null }));

    try {
      const update = await check();
      if (update) {
        // plugin-updater v2 的 Update 对象：{ available: bool, version, date, body, ... }
        // check() 在「已最新」时返回 null，所以走到这里就是 available=true
        setState((s) => ({
          ...s,
          status: 'available',
          update,
          latestVersion: update.version,
          notes: update.body ?? null,
          errorMessage: null,
          // 新版本号到来 → reset "about seen"，让外层红点对每个新版至少出现一次
          aboutSeenVersion:
            s.aboutSeenVersion === update.version ? update.version : null,
        }));
        return true;
      } else {
        setState((s) => ({
          ...s,
          status: 'up-to-date',
          update: null,
          latestVersion: null,
          notes: null,
          errorMessage: null,
        }));
        return false;
      }
    } catch (err) {
      console.error('[updater] check failed:', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Unknown update error';
      setState((s) => ({
        ...s,
        status: 'error',
        errorMessage: message,
      }));
      throw err;
    } finally {
      busyRef.current = false;
    }
  }, []);

  const downloadAndInstall = useCallback(async (): Promise<void> => {
    if (!isTauri()) return;
    if (busyRef.current) return;
    busyRef.current = true;

    // 读一次最新的 update 引用（state 里可能还没 re-render 到 downloading 前就要开始）
    const current = await new Promise<Update | null>((resolve) => {
      setState((s) => {
        resolve(s.update);
        return s;
      });
    });

    if (!current) {
      busyRef.current = false;
      return;
    }

    setState((s) => ({
      ...s,
      status: 'downloading',
      progress: 0,
      errorMessage: null,
    }));

    try {
      let downloaded = 0;
      let total = 0;

      // downloadAndInstall 会一路跑完：下载 → 校验签名 → install → （大部分平台）app 退出
      await current.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setState((s) => ({
              ...s,
              progress: total > 0 ? Math.min(downloaded / total, 1) : null,
            }));
            break;
          case 'Finished':
            setState((s) => ({ ...s, status: 'ready', progress: 1 }));
            break;
        }
      });

      // 对于 macOS / Windows：downloadAndInstall 完成后需要手动 relaunch
      // 对于 Linux AppImage：plugin 会自动 relaunch
      // 稳妥起见，两个平台都显式 relaunch 一次
      setState((s) => ({ ...s, status: 'installing' }));
      await relaunch();
      // 理论上这里不会到达（进程已重启）
    } catch (err) {
      console.error('[updater] downloadAndInstall failed:', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Unknown install error';
      setState((s) => ({
        ...s,
        status: 'error',
        errorMessage: message,
      }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) =>
      s.latestVersion
        ? { ...s, dismissedVersion: s.latestVersion }
        : s
    );
  }, []);

  const markAboutSeen = useCallback(() => {
    setState((s) =>
      s.latestVersion
        ? { ...s, aboutSeenVersion: s.latestVersion }
        : s
    );
  }, []);

  // ── 启动自动检查（M3） ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    // 延迟 3s 避免阻塞首屏。用户此时大概率已进入主界面。
    const id = setTimeout(() => {
      // fire-and-forget：网络异常、未配置 endpoint 等情况不要打扰用户
      checkForUpdates().catch((err) => {
        console.warn('[updater] startup check failed (silent):', err);
      });
    }, STARTUP_CHECK_DELAY_MS);

    return () => clearTimeout(id);
  }, [checkForUpdates]);

  return (
    <UpdateContext.Provider
      value={{
        ...state,
        checkForUpdates,
        downloadAndInstall,
        dismiss,
        markAboutSeen,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useUpdate(): UpdateContextType {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error('useUpdate must be used inside <UpdateProvider>');
  }
  return ctx;
}
