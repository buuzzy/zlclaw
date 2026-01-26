/**
 * Setup Page - First-time dependency installation
 *
 * Checks if required CLI tools (Claude Code, Codex) are installed
 * and guides users through installation.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import { saveSettingItem } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
} from 'lucide-react';

import { clearDependencyCache } from '@/components/setup-guard';

// Helper function to copy text to clipboard
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  }
};

// Helper function to open terminal with command
const openTerminalWithCommand = async (command: string) => {
  // Copy command to clipboard first
  await copyToClipboard(command);

  try {
    // Open Terminal.app
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath('/System/Applications/Utilities/Terminal.app');
  } catch (error) {
    console.error('Failed to open terminal:', error);
  }
};

interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installUrl: string;
}

interface InstallCommands {
  npm?: string;
  brew?: string;
  manual?: string;
}

interface SetupPageProps {
  /** Called when user skips setup (used by SetupGuard) */
  onSkip?: () => void;
}

export function SetupPage({ onSkip }: SetupPageProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [allRequiredInstalled, setAllRequiredInstalled] = useState(false);
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [installCommands, setInstallCommands] = useState<
    Record<string, InstallCommands>
  >({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Handle copy command
  const handleCopy = async (cmd: string) => {
    const success = await copyToClipboard(cmd);
    if (success) {
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(null), 2000);
    }
  };

  // Handle run command in terminal
  const handleRunInTerminal = async (cmd: string) => {
    await openTerminalWithCommand(cmd);
  };

  // Check dependencies on mount
  useEffect(() => {
    checkDependencies();
  }, []);

  const checkDependencies = async () => {
    setLoading(true);
    setApiError(null);
    // Clear SetupGuard cache to ensure fresh check on continue
    clearDependencyCache();

    // Retry logic for API not ready
    const maxRetries = 5;
    const retryDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${API_BASE_URL}/health/dependencies`);
        const data = await response.json();

        if (data.success) {
          setDependencies(data.dependencies);
          setAllRequiredInstalled(data.allRequiredInstalled);
          setRetryCount(0);

          // Load install commands for not-installed deps
          for (const dep of data.dependencies) {
            if (!dep.installed) {
              loadInstallCommands(dep.id);
            }
          }
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error(
          `[Setup] Attempt ${attempt + 1}/${maxRetries} failed:`,
          error
        );
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          setRetryCount(attempt + 1);
        } else {
          setApiError(
            error instanceof Error
              ? error.message
              : 'Unable to connect to API service. Please restart the app.'
          );
        }
      }
    }
    setLoading(false);
  };

  const loadInstallCommands = async (depId: string) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/health/dependencies/${depId}/install-commands`
      );
      const data = await response.json();
      if (data.success) {
        setInstallCommands((prev) => ({
          ...prev,
          [depId]: data.commands,
        }));
      }
    } catch (error) {
      console.error(
        `[Setup] Failed to load install commands for ${depId}:`,
        error
      );
    }
  };

  const handleContinue = async () => {
    // Mark setup as completed
    await saveSettingItem('setupCompleted', 'true');
    // Clear the dependency cache so SetupGuard will re-check
    clearDependencyCache();

    // If called from SetupGuard, use callback
    if (onSkip) {
      onSkip();
      return;
    }

    // Otherwise navigate back
    const from = (location.state as { from?: Location })?.from;
    navigate(from?.pathname || '/', { replace: true });
  };

  const handleSkip = async () => {
    // Mark setup as completed even if skipped
    await saveSettingItem('setupCompleted', 'true');
    // Clear cache so next check will be fresh
    clearDependencyCache();

    // If called from SetupGuard, use callback
    if (onSkip) {
      onSkip();
      return;
    }

    // Otherwise navigate back
    const from = (location.state as { from?: Location })?.from;
    navigate(from?.pathname || '/', { replace: true });
  };

  if (loading) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-primary size-8 animate-spin" />
          <p className="text-muted-foreground">
            {retryCount > 0
              ? `${t.setup?.connecting || 'Connecting to service'}... (${retryCount}/5)`
              : t.setup?.checking || 'Checking dependencies...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-svh items-center justify-center">
      {/* Main Container - Centered */}
      <div className="w-full max-w-2xl px-6">
        {/* Header */}
        <div className="border-border border-b py-6">
          <h1 className="text-foreground text-2xl font-semibold">
            {t.setup?.title || 'Welcome to WorkAny'}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t.setup?.subtitle ||
              "Let's make sure you have all the required tools installed"}
          </p>
        </div>

        {/* Content */}
        <div className="py-6">
          <div className="space-y-4">
            {/* API Error */}
            {apiError && (
              <div className="border-border rounded-xl border bg-orange-500/5 p-6">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
                    <AlertCircle className="size-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-foreground font-medium">
                      {t.setup?.apiError || 'Unable to check dependencies'}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t.setup?.apiErrorHint ||
                        'The background service may still be starting. Please wait a few seconds and retry.'}
                    </p>
                    <p className="text-muted-foreground/60 mt-1 font-mono text-xs">
                      {apiError}
                    </p>
                    <button
                      onClick={checkDependencies}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                    >
                      <RefreshCw className="size-4" />
                      {t.setup?.retry || 'Retry'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* No dependencies loaded yet */}
            {!apiError && dependencies.length === 0 && (
              <div className="border-border rounded-xl border p-6 text-center">
                <p className="text-muted-foreground">
                  {t.setup?.noDeps || 'No dependencies to check'}
                </p>
              </div>
            )}

            {dependencies.map((dep) => {
              const isExpanded = expandedDep === dep.id;
              const commands = installCommands[dep.id];

              return (
                <div
                  key={dep.id}
                  className={cn(
                    'border-border rounded-xl border transition-all',
                    dep.installed ? 'bg-muted/30' : 'bg-background'
                  )}
                >
                  {/* Dependency Header */}
                  <div className="flex items-center gap-4 p-4">
                    {/* Status Icon */}
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-full',
                        dep.installed
                          ? 'bg-green-500/10 text-green-500'
                          : dep.required
                            ? 'bg-orange-500/10 text-orange-500'
                            : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {dep.installed ? (
                        <CheckCircle2 className="size-5" />
                      ) : (
                        <Terminal className="size-5" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">
                          {dep.name}
                        </span>
                        {dep.required && !dep.installed && (
                          <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-500">
                            {t.setup?.required || 'Required'}
                          </span>
                        )}
                        {!dep.required && (
                          <span className="text-muted-foreground rounded bg-gray-500/10 px-1.5 py-0.5 text-[10px] font-medium">
                            {t.setup?.optional || 'Optional'}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {dep.description}
                      </p>
                      {dep.installed && dep.version && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t.setup?.version || 'Version'}: {dep.version}
                        </p>
                      )}
                    </div>

                    {/* Action */}
                    {dep.installed ? (
                      <Check className="size-5 shrink-0 text-green-500" />
                    ) : (
                      <button
                        onClick={() =>
                          setExpandedDep(isExpanded ? null : dep.id)
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-5" />
                        ) : (
                          <ChevronRight className="size-5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Install Options (Expanded) */}
                  {!dep.installed && isExpanded && (
                    <div className="border-border border-t px-4 py-4">
                      {/* Install Commands */}
                      {commands && (
                        <div className="space-y-2">
                          {commands.npm && (
                            <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
                              <code className="flex-1 font-mono text-sm">
                                {commands.npm}
                              </code>
                              <button
                                onClick={() =>
                                  handleRunInTerminal(commands.npm!)
                                }
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                <Play className="size-3" />
                                {t.setup?.run || 'Run'}
                              </button>
                              <button
                                onClick={() => handleCopy(commands.npm!)}
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                {copiedCmd === commands.npm ? (
                                  <Check className="size-3 text-green-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                {t.setup?.copy || 'Copy'}
                              </button>
                            </div>
                          )}
                          {commands.brew && (
                            <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
                              <code className="flex-1 font-mono text-sm">
                                {commands.brew}
                              </code>
                              <button
                                onClick={() =>
                                  handleRunInTerminal(commands.brew!)
                                }
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                <Play className="size-3" />
                                {t.setup?.run || 'Run'}
                              </button>
                              <button
                                onClick={() => handleCopy(commands.brew!)}
                                className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-xs transition-colors"
                              >
                                {copiedCmd === commands.brew ? (
                                  <Check className="size-3 text-green-500" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                {t.setup?.copy || 'Copy'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-border border-t py-4">
          <div className="flex items-center justify-between">
            {/* Refresh Button */}
            <button
              onClick={checkDependencies}
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
            >
              <RefreshCw className="size-4" />
              {t.setup?.refresh || 'Refresh'}
            </button>

            <div className="flex items-center gap-3">
              {/* Skip Button */}
              {!allRequiredInstalled && (
                <button
                  onClick={handleSkip}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
                >
                  {t.setup?.skipForNow || 'Skip for now'}
                </button>
              )}

              {/* Continue Button */}
              <button
                onClick={handleContinue}
                disabled={
                  !allRequiredInstalled &&
                  dependencies.some((d) => d.required && !d.installed)
                }
                className={cn(
                  'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors',
                  allRequiredInstalled
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                {allRequiredInstalled
                  ? t.setup?.continue || 'Continue'
                  : t.setup?.installRequired || 'Install required tools'}
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
