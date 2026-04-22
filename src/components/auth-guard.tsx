import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/shared/providers/auth-provider';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * AuthGuard — 最外层守卫
 *
 * loading → 空白等待（避免闪烁）
 * unauthenticated → 跳转 /login
 * authenticated + dbReady → 渲染子组件（SetupGuard + 应用内容）
 * authenticated + !dbReady → 继续显示 loading（SQLite 正在按 uid 绑定）
 *
 * 为什么要等 dbReady：
 *   M1 之后本地 DB 按账号独立（~/.sage/users/{uid}/sage.db）。
 *   从 cloud session resolve 到 DB bind 完成之间有个短暂窗口（通常 <100ms），
 *   如果此时就让 Home 页查询 sessions 列表，会读到 null 或残留的旧账号残影。
 *   所以把 dbReady 并入 gate，确保业务页只在 DB 切换完毕后挂载。
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { status, dbReady } = useAuth();

  if (status === 'loading' || (status === 'authenticated' && !dbReady)) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="border-primary/30 border-t-primary size-6 animate-spin rounded-full border-2" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
