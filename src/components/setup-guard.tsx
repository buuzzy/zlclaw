/**
 * Setup Guard Component
 *
 * Checks if Claude Code is installed on app startup.
 * If not installed, renders the SetupPage component.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { SetupPage } from '@/app/pages/Setup';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import { Loader2 } from 'lucide-react';

interface SetupGuardProps {
  children: ReactNode;
}

// Cache the check result to avoid repeated API calls during navigation
let cachedInstalled: boolean | null = null;

async function checkClaudeCode(): Promise<boolean> {
  if (cachedInstalled !== null) {
    return cachedInstalled;
  }

  const maxRetries = 10;
  const retryDelay = 500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/health/dependencies`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        const isInstalled = data.claudeCode ?? false;
        cachedInstalled = isInstalled;
        return isInstalled;
      }
    } catch (error) {
      console.log(
        `[SetupGuard] Check attempt ${attempt + 1}/${maxRetries} failed:`,
        error
      );
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  return false;
}

// Export function to clear cache
export function clearDependencyCache() {
  cachedInstalled = null;
}

export function SetupGuard({ children }: SetupGuardProps) {
  const { t } = useLanguage();
  const [checking, setChecking] = useState(true);
  const [installed, setInstalled] = useState(false);

  // Check on mount
  useEffect(() => {
    let mounted = true;

    checkClaudeCode().then((result) => {
      if (mounted) {
        setInstalled(result);
        setChecking(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Loading state
  if (checking) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-primary size-8 animate-spin" />
          <p className="text-muted-foreground text-sm">
            {t.setup?.checkingEnvironment || 'Checking environment...'}
          </p>
        </div>
      </div>
    );
  }

  // Not installed - show SetupPage with skip callback
  if (!installed) {
    return <SetupPage onSkip={() => setInstalled(true)} />;
  }

  // All good
  return <>{children}</>;
}
