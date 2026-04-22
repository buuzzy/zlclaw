/**
 * ErrorBoundary — React 错误边界
 *
 * 捕获渲染阶段的同步错误：
 *   • 子组件 throw
 *   • constructor / getDerivedStateFromProps / render 异常
 *
 * 不能捕获：
 *   • 事件处理器里的错误（走 window.onerror）
 *   • 异步错误（走 unhandledrejection）
 *   • SSR 错误
 *
 * 捕获后调 reportError() 上云，UI 展示 fallback。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/shared/sync';

interface Props {
  children: ReactNode;
  /** 可选自定义 fallback UI；默认是通用的错误卡片 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 上报，故意不 await — 不阻塞 UI 渲染
    void reportError({
      error_type: 'crash',
      message: error.message || String(error),
      stack_trace: error.stack,
      context: {
        component_stack: info.componentStack ?? undefined,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
    });
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="bg-background flex min-h-svh items-center justify-center p-6">
        <div className="border-border bg-card w-full max-w-md rounded-2xl border p-6 shadow-md">
          <h1 className="text-foreground text-lg font-semibold">
            出了点小问题
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            我们已经收到自动报告，稍后会排查这个问题。你可以尝试刷新继续使用。
          </p>
          <details className="text-muted-foreground mt-4 text-xs">
            <summary className="cursor-pointer select-none">
              技术细节
            </summary>
            <pre className="bg-muted mt-2 max-h-40 overflow-auto rounded p-2 text-[11px] leading-relaxed">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={this.reset}
              className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
