import type { ReactNode } from 'react';
import { theme as antdTheme, ConfigProvider } from 'antd';

import { useTheme } from './theme-provider';

const FINANCE_TOKENS = {
  colorPrimary: '#06B6D4',
  colorSuccess: '#10B981',
  colorError: '#EF4444',
  colorWarning: '#F59E0B',
  borderRadius: 8,
};

export function AntdThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          ...FINANCE_TOKENS,
          colorBgContainer: isDark ? '#1e1e1e' : '#ffffff',
          colorText: isDark ? '#fafafa' : '#18181b',
          colorTextSecondary: isDark ? '#a1a1aa' : '#71717a',
          colorBorder: isDark ? '#27272a' : '#e4e4e7',
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
