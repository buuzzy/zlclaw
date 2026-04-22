import { createBrowserRouter } from 'react-router-dom';
import { HomePage, LibraryPage, LoginPage, SetupPage, TaskDetailPage } from '@/app/pages';

import { AuthGuard } from '@/components/auth-guard';
import { SetupGuard } from '@/components/setup-guard';

export const router = createBrowserRouter([
  // 登录页（无需守卫）
  {
    path: '/login',
    element: <LoginPage />,
  },
  // 主应用页面（AuthGuard > SetupGuard > 页面）
  {
    path: '/',
    element: (
      <AuthGuard>
        <SetupGuard>
          <HomePage />
        </SetupGuard>
      </AuthGuard>
    ),
  },
  {
    path: '/task/:taskId',
    element: (
      <AuthGuard>
        <SetupGuard>
          <TaskDetailPage />
        </SetupGuard>
      </AuthGuard>
    ),
  },
  {
    path: '/library',
    element: (
      <AuthGuard>
        <SetupGuard>
          <LibraryPage />
        </SetupGuard>
      </AuthGuard>
    ),
  },
  {
    path: '/setup',
    element: <SetupPage />,
  },
]);
