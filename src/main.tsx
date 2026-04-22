import '@ant-design/v5-patch-for-react-19';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { ErrorBoundary } from './components/error-boundary';
import { initializeSettings } from './shared/db/settings';
import { AntdThemeProvider } from './shared/providers/antd-theme-provider';
import { AuthProvider } from './shared/providers/auth-provider';
import { LanguageProvider } from './shared/providers/language-provider';
import { ThemeProvider } from './shared/providers/theme-provider';
import {
  flushErrorQueue,
  ProfileProvider,
  reportError,
  retryFailedChannels,
  SessionSyncProvider,
  SettingsSyncProvider,
} from './shared/sync';

import '@/config/style/global.css';

// ─── Global error listeners ──────────────────────────────────────────────────
//
// 注册一次即可，不会卸载。确保最早挂上，能抓到后续任何 React/异步错误。
// 注意：必须先挂 listener 再 render，免得首屏错误漏掉。

if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    // 忽略跨域 script error（window.onerror 的老 bug，message 就是字面量）
    if (ev.message === 'Script error.') return;
    void reportError({
      error_type: 'window_error',
      message: ev.message || 'Unknown window error',
      stack_trace: ev.error?.stack,
      context: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        url: window.location.href,
      },
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const message =
      (reason instanceof Error ? reason.message : null) ||
      (typeof reason === 'string' ? reason : null) ||
      'Unhandled promise rejection';
    void reportError({
      error_type: 'unhandled_rejection',
      message,
      stack_trace: reason instanceof Error ? reason.stack : undefined,
      context: {
        url: window.location.href,
        reason_type: typeof reason,
      },
    });
  });

  // 网络恢复时自动重试所有 failed 的同步链路
  //
  // 两条互补的触发源：
  //   1) `window.online` 事件 — 最理想情况，但 macOS WKWebView 常常不 emit
  //      （它维护自己的在线判断，和系统网络状态不一致）
  //   2) 定时轮询 — 兜底。每 5s 检查一次 failed 链路，但受指数退避控制：
  //      同一链路连续失败多次时不会频繁重试（15s → 30s → 60s → 120s 封顶）。
  //      这样长期断网时 UI 保持 failed 静止，不会反复闪"同步中"。
  //
  // force=true 表示忽略退避窗口，立刻试一次（online 事件和用户手动点击使用）。
  window.addEventListener('online', () => {
    console.log('[sync] window.online fired, retrying failed channels');
    void retryFailedChannels({ force: true });
    void flushErrorQueue();
  });

  const RETRY_POLL_MS = 5_000;
  setInterval(() => {
    void retryFailedChannels();
  }, RETRY_POLL_MS);
}

// Initialize settings from database on startup, then render app
initializeSettings()
  .catch(console.error)
  .finally(() => {
    // Flush 离线错误队列，fire-and-forget
    void flushErrorQueue();

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <LanguageProvider>
            <ThemeProvider>
              <AntdThemeProvider>
                <AuthProvider>
                  <ProfileProvider>
                    <SettingsSyncProvider>
                      <SessionSyncProvider>
                        <RouterProvider router={router} />
                      </SessionSyncProvider>
                    </SettingsSyncProvider>
                  </ProfileProvider>
                </AuthProvider>
              </AntdThemeProvider>
            </ThemeProvider>
          </LanguageProvider>
        </ErrorBoundary>
      </React.StrictMode>
    );
  });
