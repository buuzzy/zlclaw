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
 * authenticated → 渲染子组件（SetupGuard + 应用内容）
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { status } = useAuth();

  if (status === 'loading') {
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
