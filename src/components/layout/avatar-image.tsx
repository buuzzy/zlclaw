/**
 * AvatarImage — 带失败回退 + 网络恢复自动重载的头像组件
 *
 * 场景：
 *   用户头像可能是 http(s) URL（GitHub/Google CDN）或 data URI（用户本地上传）。
 *   断网状态下进入 app，<img> 加载失败。即使后来网络恢复，浏览器也不会
 *   主动重新请求这个 URL（src 没变，DOM 元素状态是 broken）。
 *
 * 本组件做两件事：
 *   1. onError 时切换到 fallback（User 图标），避免用户看到破损问号图
 *   2. 监听 sync-status：只要之前失败过加载（hadErrorRef），且同步状态
 *      从 failed 切到 ok（意味着网络刚恢复），就对 URL 加一个自增的
 *      `_retry=N` 参数让浏览器重新请求。
 *      data URI 不会进入这个分支（加载失败可能性极低，且不适合加参数）。
 */

import { useEffect, useRef, useState } from 'react';
import { useSyncStatus } from '@/shared/sync';
import { User } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface Props {
  src: string;
  alt?: string;
  className?: string;
  iconClassName?: string;
}

function isDataUri(url: string): boolean {
  return url.startsWith('data:');
}

function bustUrl(url: string, n: number): string {
  if (isDataUri(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('_retry', String(n));
    return u.toString();
  } catch {
    return url;
  }
}

export function AvatarImage({
  src,
  alt,
  className,
  iconClassName,
}: Props) {
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const prevOverallRef = useRef(useSyncStatus().overall);
  const hadErrorRef = useRef(false);
  const { overall } = useSyncStatus();

  // src 变化时重置错误态（例如用户换了头像）
  useEffect(() => {
    setHasError(false);
    hadErrorRef.current = false;
    setRetryCount(0);
  }, [src]);

  // 网络恢复时（overall: failed → ok/syncing），若曾失败过，强制 bust 一次
  useEffect(() => {
    const prev = prevOverallRef.current;
    if (
      hadErrorRef.current &&
      prev === 'failed' &&
      (overall === 'ok' || overall === 'syncing') &&
      !isDataUri(src)
    ) {
      setRetryCount((n) => n + 1);
      setHasError(false);
      hadErrorRef.current = false;
    }
    prevOverallRef.current = overall;
  }, [overall, src]);

  if (!src || hasError) {
    return <User className={cn(iconClassName ?? className)} />;
  }

  const finalSrc = retryCount > 0 ? bustUrl(src, retryCount) : src;

  return (
    <img
      src={finalSrc}
      alt={alt}
      className={className}
      onError={() => {
        hadErrorRef.current = true;
        setHasError(true);
      }}
    />
  );
}
