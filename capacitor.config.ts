import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.sage.app',
  appName: 'Sage',
  webDir: 'dist',
  server: {
    // Use https scheme so OAuth redirects work properly
    // (capacitor:// is not a valid HTTP redirect URL)
    iosScheme: 'https',
  },
};

export default config;
