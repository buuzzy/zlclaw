/**
 * SyncStatusIndicator — sidebar 底部显示云同步状态
 *
 * 展开态：圆点 + 文字（"同步中" / "已同步 3 秒前" / "同步失败"）
 * 折叠态：只圆点，hover 出 tooltip
 *
 * 配合 useSyncStatus() 订阅 sync-status 变化。
 */

import { useEffect, useState } from 'react';
import { retryFailedChannels, useSyncStatus, type OverallStatus } from '@/shared/sync';
import { cn } from '@/shared/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
  compact?: boolean;
}

function statusTheme(status: OverallStatus): {
  dot: string; // Tailwind background 颜色
  ping: boolean; // 是否显示呼吸动画
  label: string;
} {
  switch (status) {
    case 'syncing':
      return {
        dot: 'bg-amber-400',
        ping: true,
        label: '同步中',
      };
    case 'failed':
      return {
        dot: 'bg-red-500',
        ping: false,
        label: '同步失败',
      };
    case 'ok':
      return {
        dot: 'bg-green-500',
        ping: false,
        label: '已同步',
      };
    case 'idle':
    default:
      return {
        dot: 'bg-muted-foreground/40',
        ping: false,
        label: '等待同步',
      };
  }
}

function formatRelative(ts: number | null): string {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 10_000) return '刚刚';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function SyncStatusIndicator({ compact = false }: Props) {
  const snap = useSyncStatus();
  const theme = statusTheme(snap.overall);

  // 每 30 秒刷新一次"x 秒前"文本
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Tooltip 详细文案
  const failedChannels = Object.entries(snap.channels)
    .filter(([, c]) => c.state === 'failed')
    .map(([name, c]) => `${name}: ${c.lastError ?? '失败'}`);

  const tooltipLines: string[] = [theme.label];
  if (snap.overall === 'ok' || snap.overall === 'idle') {
    const rel = formatRelative(snap.lastSyncedAt);
    if (rel) tooltipLines.push(`最近同步：${rel}`);
  }
  if (failedChannels.length > 0) {
    tooltipLines.push(...failedChannels);
  }

  const Dot = (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      {theme.ping && (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-75',
            theme.dot
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex size-2 rounded-full',
          theme.dot
        )}
      />
    </span>
  );

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={snap.overall !== 'failed'}
            onClick={() => {
              void retryFailedChannels({ force: true });
            }}
            className="flex items-center justify-center py-1 disabled:cursor-default"
          >
            {Dot}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="whitespace-pre-line text-xs">
          {tooltipLines.join('\n')}
          {snap.overall === 'failed' ? '\n\n点击立即重试' : ''}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={snap.overall !== 'failed'}
          onClick={() => {
            void retryFailedChannels({ force: true });
          }}
          className={cn(
            'text-sidebar-foreground/50 flex items-center gap-2 px-3 py-1 text-xs',
            snap.overall === 'failed' && 'hover:text-sidebar-foreground/70 cursor-pointer',
            snap.overall !== 'failed' && 'cursor-default'
          )}
        >
          {Dot}
          <span className="truncate">
            {theme.label}
            {snap.overall === 'ok' && snap.lastSyncedAt ? (
              <span className="text-sidebar-foreground/35 ml-1">
                · {formatRelative(snap.lastSyncedAt)}
              </span>
            ) : null}
            {snap.overall === 'failed' ? (
              <span className="text-sidebar-foreground/35 ml-1">· 点击重试</span>
            ) : null}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="whitespace-pre-line text-xs">
        {tooltipLines.join('\n')}
      </TooltipContent>
    </Tooltip>
  );
}
