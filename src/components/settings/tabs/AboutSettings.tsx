import { useEffect, useState } from 'react';
import ImageLogo from '@/assets/logo.png';
import { useLanguage } from '@/shared/providers/language-provider';
import { useUpdate } from '@/shared/providers/update-provider';
import { supabaseMeta } from '@/shared/lib/supabase';
import { getVersion } from '@tauri-apps/api/app';
import {
  CheckCircle,
  Download,
  ExternalLink,
  Github,
  Globe,
  Loader2,
  MessageSquareWarning,
  Sparkles,
  XCircle,
} from 'lucide-react';

const noop = () => {};

/**
 * AboutSettings
 *
 * M2: "检查更新"按钮 + 状态反馈（checking / up-to-date / available / error）
 * M4: 底部显示当前 Supabase 环境（dev / prod / other）供排查
 */
export function AboutSettings() {
  const { t } = useLanguage();
  const [version, setVersion] = useState('0.0.0');
  const {
    status,
    latestVersion,
    errorMessage,
    checkForUpdates,
    downloadAndInstall,
  } = useUpdate();

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('0.0.0'));
  }, []);

  // ─── "检查更新"按钮的动态 UI ──────────────────────────────────────────────
  // 状态 → (Icon, label, onClick, variant)
  type ButtonVariant = 'primary' | 'neutral' | 'danger';
  const btn: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    variant: ButtonVariant;
    disabled?: boolean;
  } = (() => {
    if (status === 'checking') {
      return {
        icon: <Loader2 className="size-4 animate-spin" />,
        label: t.update.checking,
        onClick: noop,
        variant: 'neutral',
        disabled: true,
      };
    }
    if (status === 'downloading' || status === 'ready' || status === 'installing') {
      return {
        icon: <Loader2 className="size-4 animate-spin" />,
        label:
          status === 'downloading'
            ? t.update.downloading
            : status === 'ready'
              ? t.update.readyToInstall
              : t.update.installing,
        onClick: noop,
        variant: 'neutral',
        disabled: true,
      };
    }
    if (status === 'available' && latestVersion) {
      return {
        icon: <Sparkles className="size-4" />,
        label: t.update.updateAvailable.replace('{version}', latestVersion),
        onClick: () => {
          void downloadAndInstall();
        },
        variant: 'primary',
      };
    }
    if (status === 'up-to-date') {
      return {
        icon: <CheckCircle className="size-4" />,
        label: t.update.upToDate,
        onClick: () => {
          // 允许再点一次（轮询 re-check，很便宜）
          void checkForUpdates().catch(() => {});
        },
        variant: 'neutral',
      };
    }
    if (status === 'error') {
      return {
        icon: <XCircle className="size-4" />,
        label: t.update.tryAgain,
        onClick: () => {
          void checkForUpdates().catch(() => {});
        },
        variant: 'danger',
      };
    }
    // idle
    return {
      icon: <Download className="size-4" />,
      label: t.update.checkForUpdates,
      onClick: () => {
        void checkForUpdates().catch(() => {});
      },
      variant: 'primary',
    };
  })();

  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90',
    neutral:
      'border-border bg-muted text-foreground hover:bg-accent border',
    danger:
      'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 border',
  };

  return (
    <div className="space-y-6">
      {/* Product Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={ImageLogo} alt="涨乐金融龙虾" className="size-16 rounded-xl" />
          <div>
            <h2 className="text-foreground text-xl font-bold">涨乐金融龙虾</h2>
            <p className="text-muted-foreground text-sm">
              {t.settings.aiPlatform}
            </p>
          </div>
        </div>
        <button
          onClick={btn.onClick}
          disabled={btn.disabled}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${variantClasses[btn.variant]} ${
            btn.disabled ? '' : 'cursor-pointer'
          }`}
        >
          {btn.icon}
          {btn.label}
        </button>
      </div>

      {/* 检查失败时的错误提示 */}
      {status === 'error' && errorMessage && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-xs">
          {t.update.checkFailed}: {errorMessage}
        </div>
      )}

      {/* Version & Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.version}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {version}
          </p>
        </div>
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.build}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {__BUILD_DATE__}
          </p>
        </div>
      </div>

      {/* Author & Copyright */}
      <div className="space-y-3">
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.author}
          </span>
          <span className="text-foreground flex items-center gap-1 text-sm font-medium">
            nakocai
            <ExternalLink className="size-3" />
          </span>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.copyright}
          </span>
          <span className="text-foreground flex items-center gap-1 text-sm font-medium">
            © 2026 涨乐金融龙虾
          </span>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.license}
          </span>
          <span className="text-foreground flex items-center gap-1 text-sm font-medium">
            涨乐金融龙虾 Community License
          </span>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={noop}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <Globe className="size-4" />
          {t.settings.website}
        </button>
        <button
          onClick={noop}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <Github className="size-4" />
          {t.settings.viewSource}
        </button>
        <button
          onClick={noop}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          {t.settings.joinCommunity}
        </button>
        <button
          onClick={noop}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          {t.settings.followUs}
        </button>
        <button
          onClick={noop}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <MessageSquareWarning className="size-4" />
          {t.settings.reportIssue}
        </button>
      </div>

      {/* Based on WorkAny by nakocai + 环境标签（M4） */}
      <div className="border-border flex items-center justify-between border-t pt-4">
        <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
          Based on WorkAny by nakocai
        </span>
        <span className="text-muted-foreground/60 text-xs">
          {supabaseMeta.env === 'dev'
            ? t.update.envDev
            : supabaseMeta.env === 'prod'
              ? t.update.envProd
              : t.update.envOther}
          <span className="mx-1">·</span>
          {new URL(supabaseMeta.url).hostname}
        </span>
      </div>
    </div>
  );
}
