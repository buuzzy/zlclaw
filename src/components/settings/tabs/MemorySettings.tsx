/**
 * Memory Settings — Status monitoring panel for the memory pipeline.
 *
 * Shows:
 *   - Index status (chunk count, model, last indexed)
 *   - Indexed source files list
 *   - Embedding configuration status
 *   - Manual consolidation + reindex triggers
 */

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MemoryStatus {
  configured: boolean;
  indexed: boolean;
  chunkCount: number;
  lastIndexedAt: string | null;
  model: string | null;
  sources: string[];
  indexing: boolean;
}

interface EmbeddingConfig {
  configured: boolean;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKeyMasked?: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MemorySettings() {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [embeddingConfig, setEmbeddingConfig] =
    useState<EmbeddingConfig | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [lastAction, setLastAction] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch(`${API_BASE_URL}/memory/status`),
        fetch(`${API_BASE_URL}/memory/config`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (configRes.ok) setEmbeddingConfig(await configRes.json());
    } catch {
      // silently ignore — backend may not be ready yet
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll while indexing
  useEffect(() => {
    if (!status?.indexing && !indexing) return;
    const timer = setInterval(fetchStatus, 2000);
    return () => clearInterval(timer);
  }, [status?.indexing, indexing, fetchStatus]);

  const handleReindex = async () => {
    setIndexing(true);
    setLastAction(null);
    try {
      const res = await fetch(`${API_BASE_URL}/memory/index`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setLastAction({
          type: 'success',
          message: `重建索引完成，共 ${data.chunkCount ?? '?'} 个片段`,
        });
        await fetchStatus();
      } else {
        setLastAction({ type: 'error', message: data.error || '重建索引失败' });
      }
    } catch (err) {
      setLastAction({ type: 'error', message: (err as Error).message });
    } finally {
      setIndexing(false);
    }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    setLastAction(null);
    try {
      const res = await fetch(`${API_BASE_URL}/memory/consolidate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        const processed = data.processed?.join(', ') || '无';
        const failed = data.failed?.join(', ') || '无';
        setLastAction({
          type: 'success',
          message: `归纳完成 — 已处理: ${processed}，失败: ${failed}`,
        });
        await fetchStatus();
      } else {
        setLastAction({ type: 'error', message: data.error || '记忆归纳失败' });
      }
    } catch (err) {
      setLastAction({ type: 'error', message: (err as Error).message });
    } finally {
      setConsolidating(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Index Status Card ── */}
      <div className="border-border space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="text-primary size-4" />
            <h3 className="text-foreground text-sm font-semibold">向量索引</h3>
          </div>
          <button
            onClick={fetchStatus}
            className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
            title="刷新状态"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        {status ? (
          <div className="grid grid-cols-2 gap-3">
            {/* Indexed */}
            <div className="bg-muted/30 space-y-0.5 rounded-lg p-3">
              <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                状态
              </p>
              <div className="flex items-center gap-1.5">
                {status.indexing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin text-amber-500" />
                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                      索引中…
                    </span>
                  </>
                ) : status.indexed ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-green-500" />
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">
                      已索引
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="text-muted-foreground size-3.5" />
                    <span className="text-muted-foreground text-sm font-medium">
                      未索引
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Chunk count */}
            <div className="bg-muted/30 space-y-0.5 rounded-lg p-3">
              <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                片段数
              </p>
              <p className="text-foreground text-sm font-medium">
                {status.chunkCount.toLocaleString()}
              </p>
            </div>

            {/* Model */}
            <div className="bg-muted/30 space-y-0.5 rounded-lg p-3">
              <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                嵌入模型
              </p>
              <p className="text-foreground truncate text-sm font-medium">
                {status.model || '—'}
              </p>
            </div>

            {/* Last indexed */}
            <div className="bg-muted/30 space-y-0.5 rounded-lg p-3">
              <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                最近索引
              </p>
              <p className="text-foreground text-sm font-medium">
                {formatTime(status.lastIndexedAt)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">无法获取索引状态</p>
        )}
      </div>

      {/* ── Indexed Sources ── */}
      {status && status.sources.length > 0 && (
        <div className="border-border space-y-2.5 rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <FileText className="text-primary size-4" />
            <h3 className="text-foreground text-sm font-semibold">
              已索引文件 ({status.sources.length})
            </h3>
          </div>
          <div className="space-y-1">
            {status.sources.map((src) => (
              <div
                key={src}
                className="hover:bg-muted/30 flex items-center gap-2 rounded-lg px-2 py-1.5"
              >
                <CheckCircle2 className="size-3 shrink-0 text-green-500" />
                <span className="text-foreground font-mono text-xs">{src}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status && status.sources.length === 0 && !status.indexing && (
        <div className="border-border rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <FileText className="text-primary size-4" />
            <h3 className="text-foreground text-sm font-semibold">
              已索引文件
            </h3>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            暂无已索引文件。请先配置嵌入向量，然后点击「重建索引」。
          </p>
        </div>
      )}

      {/* ── Embedding Config ── */}
      <div className="border-border space-y-2.5 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="text-primary size-4" />
          <h3 className="text-foreground text-sm font-semibold">
            嵌入向量配置
          </h3>
        </div>
        {embeddingConfig?.configured ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-3.5 text-green-500" />
              <span className="text-sm text-green-600 dark:text-green-400">
                已配置
              </span>
            </div>
            <div className="text-muted-foreground space-y-0.5 text-xs">
              {embeddingConfig.model && (
                <p>
                  模型:{' '}
                  <span className="text-foreground">
                    {embeddingConfig.model}
                  </span>
                </p>
              )}
              {embeddingConfig.baseUrl && (
                <p>
                  地址:{' '}
                  <span className="text-foreground truncate">
                    {embeddingConfig.baseUrl}
                  </span>
                </p>
              )}
              {embeddingConfig.apiKeyMasked && (
                <p>
                  API Key:{' '}
                  <span className="text-foreground font-mono">
                    {embeddingConfig.apiKeyMasked}
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <AlertCircle className="size-3.5 text-amber-500" />
            <p className="text-muted-foreground text-sm">
              未配置嵌入向量。未配置时仅支持关键词搜索，无法进行语义检索。
            </p>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="border-border space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Zap className="text-primary size-4" />
          <h3 className="text-foreground text-sm font-semibold">操作</h3>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {/* Reindex */}
          <button
            onClick={handleReindex}
            disabled={indexing || status?.indexing}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
              'border-border text-foreground hover:bg-accent border',
              (indexing || status?.indexing) && 'cursor-not-allowed opacity-50'
            )}
          >
            {indexing || status?.indexing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Database className="size-4" />
            )}
            重建向量索引
          </button>

          {/* Manual consolidation */}
          <button
            onClick={handleConsolidate}
            disabled={consolidating}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
              'border-border text-foreground hover:bg-accent border',
              consolidating && 'cursor-not-allowed opacity-50'
            )}
          >
            {consolidating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Brain className="size-4" />
            )}
            立即归纳记忆
          </button>
        </div>

        <p className="text-muted-foreground text-[11px]">
          「重建索引」会重新嵌入所有记忆文件（需配置嵌入向量）；
          「立即归纳」等同于手动触发每日 23:00 的 F25 任务。
        </p>
      </div>

      {/* ── Last Action Result ── */}
      {lastAction && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl p-3',
            lastAction.type === 'success'
              ? 'bg-green-500/5 text-green-600 dark:text-green-400'
              : 'bg-red-500/5 text-red-600 dark:text-red-400'
          )}
        >
          {lastAction.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          )}
          <p className="text-sm">{lastAction.message}</p>
        </div>
      )}
    </div>
  );
}
