/**
 * AvatarStatusBadge — 在头像上叠加同步状态
 *
 * 设计原则：
 *   ok      → 头像左上角一颗静止绿点（ring 描边用父容器背景色让它浮起来）
 *   syncing → 不显示任何装饰（几百 ms 的切换闪烁反而干扰）
 *   idle    → 同 syncing
 *   failed  → 头像整体蒙一层遮罩 + WifiOff icon；点击 = 立即重试
 *
 * 失败态下 mask 是一个 role="button" 的 span（不用 <button> 是为了
 * 避免嵌进外层 DropdownMenuTrigger 的 <button> 里形成非法 nested button）。
 * 通过 stopPropagation 阻止 radix DropdownMenuTrigger 的 onPointerDown
 * 打开菜单，改成触发 retryFailedChannels({ force: true })。
 *
 * 重试进行中：icon 换成旋转 Loader2。重试完成（无论成功失败）放回 WifiOff
 * 或（成功时）mask 整体卸载回到绿点。
 *
 * Tooltip 承载详细信息：状态文字、上次同步时间、失败链路列表、重试提示。
 */

import { useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  retryFailedChannels,
  useSyncStatus,
  type OverallStatus,
} from '@/shared/sync';
import { Loader2, WifiOff } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
  children: ReactNode;
  /** 绿点外环描边颜色（让角标从头像上"浮出来"）。默认 sidebar 背景 */
  ringClassName?: string;
  /** 额外 className 附加到 wrapper span */
  className?: string;
  /** tooltip 显示侧 */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
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

function statusLabel(s: OverallStatus): string {
  switch (s) {
    case 'syncing':
      return '同步中';
    case 'failed':
      return '同步失败';
    case 'ok':
      return '已同步';
    case 'idle':
    default:
      return '等待同步';
  }
}

export function AvatarStatusBadge({
  children,
  ringClassName = 'ring-sidebar',
  className,
  tooltipSide = 'right',
}: Props) {
  const snap = useSyncStatus();
  const [retrying, setRetrying] = useState(false);

  const isOk = snap.overall === 'ok';
  const isFailed = snap.overall === 'failed';

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryFailedChannels({ force: true });
    } finally {
      setRetrying(false);
    }
  };

  const failedChannels = Object.entries(snap.channels)
    .filter(([, c]) => c.state === 'failed')
    .map(([name, c]) => `${name}: ${c.lastError ?? '失败'}`);

  const tooltipLines: string[] = [statusLabel(snap.overall)];
  if (isOk && snap.lastSyncedAt) {
    tooltipLines.push(`最近同步：${formatRelative(snap.lastSyncedAt)}`);
  }
  if (failedChannels.length > 0) {
    tooltipLines.push(...failedChannels);
  }
  if (isFailed) {
    tooltipLines.push('点击头像立即重试');
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('relative inline-block', className)}>
          {children}

          {/* ok → 左上角静止绿点 */}
          {isOk && (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute -top-0.5 -left-0.5 size-2 rounded-full bg-emerald-500 ring-2',
                ringClassName
              )}
            />
          )}

          {/* failed → 遮罩 + WifiOff / Loader2 + 点击重试 */}
          {isFailed && (
            <span
              role="button"
              tabIndex={0}
              aria-label="同步失败，点击重试"
              onPointerDown={(e) => {
                // 阻止 radix DropdownMenuTrigger 打开菜单
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleRetry();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleRetry();
                }
              }}
              className={cn(
                'absolute inset-0 flex cursor-pointer items-center justify-center rounded-[inherit] bg-black/45 backdrop-blur-[1px] transition-colors',
                'hover:bg-black/55'
              )}
            >
              {retrying ? (
                <Loader2 className="size-4 animate-spin text-white" />
              ) : (
                <WifiOff className="size-4 text-white" />
              )}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={tooltipSide}
        className="text-xs whitespace-pre-line"
      >
        {tooltipLines.join('\n')}
      </TooltipContent>
    </Tooltip>
  );
}
