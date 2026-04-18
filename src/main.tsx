import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { AntdThemeProvider } from './shared/providers/antd-theme-provider';
import { initializeSettings } from './shared/db/settings';
import { LanguageProvider } from './shared/providers/language-provider';
import { ThemeProvider } from './shared/providers/theme-provider';

import '@/config/style/global.css';

// Initialize settings from database on startup, then render app
initializeSettings()
  .catch(console.error)
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <LanguageProvider>
          <ThemeProvider>
            <AntdThemeProvider>
              <RouterProvider router={router} />
            </AntdThemeProvider>
          </ThemeProvider>
        </LanguageProvider>
      </React.StrictMode>
    );
  });
