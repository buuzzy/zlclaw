/**
 * Cron Job Settings
 *
 * Manages scheduled jobs: list, create, toggle, delete, manual trigger.
 * All state comes from the backend REST API at /cron/jobs.
 */

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  X,
} from 'lucide-react';

// ─── Types (mirrors src-api cron types) ─────────────────────────────────────

type ScheduleType = 'cron' | 'every' | 'at';
type DeliveryMode = 'none' | 'channel';

interface CronSchedule {
  type: ScheduleType;
  expression?: string;
  interval?: number;
  at?: string;
  timezone?: string;
}

interface CronRun {
  startedAt: string;
  finishedAt?: string;
  status: 'success' | 'failed' | 'running';
  output?: string;
  error?: string;
}

interface CronJob {
  id: string;
  name: string;
  prompt: string;
  schedule: CronSchedule;
  delivery: DeliveryMode;
  enabled: boolean;
  system?: boolean;
  deleteAfterRun?: boolean;
  /** Max random pre-execution delay in ms. 0 = disabled. */
  jitter?: number;
  /** Target conversationId for channel delivery (e.g. Feishu chat_id) */
  targetConversationId?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runs?: CronRun[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSchedule(s: CronSchedule): string {
  if (s.type === 'cron') return `Cron: ${s.expression}${s.timezone ? ` (${s.timezone})` : ''}`;
  if (s.type === 'every') {
    const ms = s.interval ?? 0;
    if (ms >= 3600000) return `每 ${ms / 3600000} 小时`;
    if (ms >= 60000) return `每 ${ms / 60000} 分钟`;
    return `每 ${ms / 1000} 秒`;
  }
  if (s.type === 'at') return `一次性: ${s.at ? new Date(s.at).toLocaleString('zh-CN') : '-'}`;
  return '-';
}

function formatTime(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Main Component ────────────────────────────────────────────────────────

export function CronSettings() {
  const { t } = useLanguage();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const fetchJobs = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE_URL}/cron/jobs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch (err) {
      const msg = (err as Error).message;
      // Distinguish connection-refused / network errors from API-level errors
      const isOffline =
        msg.includes('Failed to fetch') ||
        msg.includes('fetch failed') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('NetworkError');
      setError(isOffline ? '无法连接到后台服务，请确认应用已正常启动' : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleToggle = async (job: CronJob) => {
    if (togglingIds.has(job.id)) return;
    setTogglingIds((prev) => new Set(prev).add(job.id));
    try {
      const res = await fetch(`${API_BASE_URL}/cron/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === job.id ? data.job : j)));
      }
    } catch {
      // ignore
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(job.id); return s; });
    }
  };

  const handleRunNow = async (job: CronJob) => {
    if (runningIds.has(job.id)) return;
    setRunningIds((prev) => new Set(prev).add(job.id));
    try {
      await fetch(`${API_BASE_URL}/cron/jobs/${job.id}/run`, { method: 'POST' });
      // refresh after a short delay so the run record appears
      setTimeout(fetchJobs, 1500);
    } catch {
      // ignore
    } finally {
      setTimeout(() => {
        setRunningIds((prev) => { const s = new Set(prev); s.delete(job.id); return s; });
      }, 1500);
    }
  };

  const handleDelete = async (job: CronJob) => {
    if (job.system) return;
    if (!window.confirm(t.settings.cronDeleteConfirm.replace('{name}', job.name))) return;
    setDeletingIds((prev) => new Set(prev).add(job.id));
    try {
      const res = await fetch(`${API_BASE_URL}/cron/jobs/${job.id}`, { method: 'DELETE' });
      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
    } catch {
      // ignore
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(job.id); return s; });
    }
  };

  const handleJobCreated = (newJob: CronJob) => {
    setJobs((prev) => [...prev, newJob]);
    setShowCreate(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-base font-semibold">{t.settings.cron}</h3>
          <p className="text-muted-foreground mt-0.5 text-sm">{t.settings.cronDescription}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus className="size-3.5" />
          {t.settings.cronAdd}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/5 p-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button onClick={fetchJobs} className="text-primary ml-auto text-xs hover:underline">
            {t.settings.cronRetry}
          </button>
        </div>
      )}

      {/* Job list */}
      {jobs.length === 0 && !error ? (
        <div className="border-border rounded-xl border border-dashed py-12 text-center">
          <Clock className="text-muted-foreground mx-auto mb-3 size-8 opacity-40" />
          <p className="text-muted-foreground text-sm">{t.settings.cronEmpty}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="text-primary mt-2 text-xs hover:underline"
          >
            {t.settings.cronAddFirst}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              expanded={expandedId === job.id}
              onExpand={() => setExpandedId(expandedId === job.id ? null : job.id)}
              toggling={togglingIds.has(job.id)}
              running={runningIds.has(job.id)}
              deleting={deletingIds.has(job.id)}
              onToggle={() => handleToggle(job)}
              onRunNow={() => handleRunNow(job)}
              onDelete={() => handleDelete(job)}
            />
          ))}
        </div>
      )}

      {/* Refresh */}
      <div className="flex justify-end">
        <button
          onClick={fetchJobs}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          <RefreshCw className="size-3" />
          {t.settings.cronRefresh}
        </button>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <CreateJobDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleJobCreated}
        />
      )}
    </div>
  );
}

// ─── Job Card ────────────────────────────────────────────────────────────────

interface JobCardProps {
  job: CronJob;
  expanded: boolean;
  toggling: boolean;
  running: boolean;
  deleting: boolean;
  onExpand: () => void;
  onToggle: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}

function JobCard({
  job, expanded, toggling, running, deleting,
  onExpand, onToggle, onRunNow, onDelete,
}: JobCardProps) {
  const lastRun = job.runs?.[job.runs.length - 1];

  return (
    <div className={cn(
      'border-border bg-background rounded-xl border transition-all',
      !job.enabled && 'opacity-60'
    )}>
      {/* Main row */}
      <div className="flex items-center gap-3 p-4">
        {/* Expand chevron */}
        <button
          onClick={onExpand}
          className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
        >
          {expanded
            ? <ChevronDown className="size-4" />
            : <ChevronRight className="size-4" />}
        </button>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-medium">{job.name}</span>
            {job.system && (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                <Shield className="size-2.5" />
                系统
              </span>
            )}
            {/* Last run status dot */}
            {lastRun && (
              <span className={cn(
                'size-1.5 rounded-full shrink-0',
                lastRun.status === 'success' && 'bg-green-500',
                lastRun.status === 'failed' && 'bg-red-500',
                lastRun.status === 'running' && 'bg-amber-400 animate-pulse',
              )} />
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {formatSchedule(job.schedule)}
            {job.lastRunAt && (
              <span className="ml-2 opacity-60">· 上次 {formatTime(job.lastRunAt)}</span>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Enable toggle */}
          <button
            onClick={onToggle}
            disabled={toggling}
            title={job.enabled ? '点击禁用' : '点击启用'}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none',
              job.enabled ? 'bg-primary' : 'bg-muted',
              toggling && 'cursor-not-allowed opacity-50'
            )}
          >
            <span className={cn(
              'inline-block size-3.5 rounded-full bg-white shadow transition-transform',
              job.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
            )} />
          </button>

          {/* Run now */}
          <button
            onClick={onRunNow}
            disabled={running}
            title="立即执行"
            className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            {running
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Play className="size-3.5" />}
          </button>

          {/* Delete */}
          {!job.system && (
            <button
              onClick={onDelete}
              disabled={deleting}
              title="删除"
              className="text-muted-foreground hover:text-destructive rounded-md p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              {deleting
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Trash2 className="size-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-border border-t px-4 pb-4 pt-3 space-y-3">
          {/* Prompt */}
          {(job.prompt || job.system) && (
            <div>
              <p className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">提示词</p>
              <p className={cn(
                'bg-muted/40 rounded-lg p-2.5 text-xs leading-relaxed',
                job.prompt ? 'text-foreground' : 'text-muted-foreground italic'
              )}>
                {job.prompt || '系统内置任务，由应用自动处理'}
              </p>
            </div>
          )}

          {/* Next run */}
          {job.nextRunAt && (
            <div className="flex items-center gap-2 text-xs">
              <Clock className="text-muted-foreground size-3.5" />
              <span className="text-muted-foreground">下次执行:</span>
              <span className="text-foreground">{formatTime(job.nextRunAt)}</span>
            </div>
          )}

          {/* Run history */}
          {job.runs && job.runs.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                最近执行记录 ({job.runs.length})
              </p>
              <div className="space-y-1.5">
                {[...job.runs].reverse().slice(0, 5).map((run, i) => (
                  <div key={i} className="bg-muted/30 flex items-start gap-2 rounded-lg p-2.5">
                    {run.status === 'success' && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-500" />}
                    {run.status === 'failed' && <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-500" />}
                    {run.status === 'running' && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-amber-500" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-xs font-medium',
                          run.status === 'success' && 'text-green-600 dark:text-green-400',
                          run.status === 'failed' && 'text-red-600 dark:text-red-400',
                          run.status === 'running' && 'text-amber-600 dark:text-amber-400',
                        )}>
                          {run.status === 'success' ? '成功' : run.status === 'failed' ? '失败' : '执行中'}
                        </span>
                        <span className="text-muted-foreground text-[11px]">{formatTime(run.startedAt)}</span>
                      </div>
                      {run.error && (
                        <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{run.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create Job Dialog ───────────────────────────────────────────────────────

interface CreateJobDialogProps {
  onClose: () => void;
  onCreated: (job: CronJob) => void;
}

function CreateJobDialog({ onClose, onCreated }: CreateJobDialogProps) {
  const { t } = useLanguage();
  const [scheduleType, setScheduleType] = useState<ScheduleType>('cron');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [expression, setExpression] = useState('0 9 * * *');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [intervalVal, setIntervalVal] = useState('60');
  const [intervalUnit, setIntervalUnit] = useState<'s' | 'm' | 'h'>('m');
  const [atVal, setAtVal] = useState('');
  const [delivery, setDelivery] = useState<DeliveryMode>('none');
  const [targetConversationId, setTargetConversationId] = useState('');
  const [jitterEnabled, setJitterEnabled] = useState(true);
  const [jitterSec, setJitterSec] = useState('30');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildSchedule = (): CronSchedule => {
    if (scheduleType === 'cron') return { type: 'cron', expression, timezone };
    if (scheduleType === 'every') {
      const mult = intervalUnit === 'h' ? 3600000 : intervalUnit === 'm' ? 60000 : 1000;
      return { type: 'every', interval: Number(intervalVal) * mult };
    }
    // datetime-local gives a local-time string without timezone info (e.g. "2025-04-18T09:00").
    // Constructing a Date from it interprets it as LOCAL time in the browser, so .toISOString()
    // correctly converts to UTC — which is what the backend scheduler expects.
    const localDate = new Date(atVal);
    return { type: 'at', at: localDate.toISOString() };
  };

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError(t.settings.cronCreateRequired);
      return;
    }
    if (delivery === 'channel' && !targetConversationId.trim()) {
      setError('推送渠道模式下，需指定目标对话 ID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/cron/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          schedule: buildSchedule(),
          delivery,
          enabled: true,
          targetConversationId: targetConversationId.trim() || undefined,
          jitter: scheduleType !== 'at' && jitterEnabled ? Math.max(0, Number(jitterSec)) * 1000 : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.settings.cronCreateFailed);
        return;
      }
      onCreated(data.job);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background border-border relative w-full max-w-md rounded-2xl border shadow-2xl">
        {/* Title */}
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-foreground text-sm font-semibold">{t.settings.cronCreateTitle}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-5" style={{ maxHeight: '70vh' }}>
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-medium">{t.settings.cronName} *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.settings.cronNamePlaceholder}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-medium">{t.settings.cronPrompt} *</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={t.settings.cronPromptPlaceholder}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Schedule type */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-medium">{t.settings.cronScheduleType}</label>
            <div className="flex gap-2">
              {(['cron', 'every', 'at'] as ScheduleType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setScheduleType(type)}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                    scheduleType === type
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {type === 'cron' ? 'Cron 表达式' : type === 'every' ? '定时间隔' : '单次执行'}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule inputs */}
          {scheduleType === 'cron' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-foreground text-xs font-medium">Cron 表达式</label>
                <input
                  type="text"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  placeholder="0 9 * * *"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="text-muted-foreground text-[11px]">
                  分 时 日 月 周 &nbsp;·&nbsp; 例: <code className="bg-muted rounded px-1">0 9 * * 1-5</code> 工作日 9 点
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-foreground text-xs font-medium">时区</label>
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Shanghai"
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {scheduleType === 'every' && (
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-medium">间隔时长</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={intervalVal}
                  onChange={(e) => setIntervalVal(e.target.value)}
                  className="border-border bg-background text-foreground flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as 's' | 'm' | 'h')}
                  className="border-border bg-background text-foreground rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="s">秒</option>
                  <option value="m">分钟</option>
                  <option value="h">小时</option>
                </select>
              </div>
            </div>
          )}

          {scheduleType === 'at' && (
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-medium">执行时间</label>
              <input
                type="datetime-local"
                value={atVal}
                onChange={(e) => setAtVal(e.target.value)}
                className="border-border bg-background text-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Delivery */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-medium">{t.settings.cronDelivery}</label>
            <div className="flex gap-2">
              {(['none', 'channel'] as DeliveryMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDelivery(mode)}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                    delivery === mode
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {mode === 'none' ? '仅记录' : '推送渠道'}
                </button>
              ))}
            </div>
            {delivery === 'channel' && (
              <p className="text-muted-foreground text-[11px]">
                需在「渠道」设置中配置消息渠道，否则结果仅记录在历史中
              </p>
            )}
          </div>

          {/* Target Conversation ID for channel delivery */}
          {delivery === 'channel' && (
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-medium">目标对话 ID（Feishu chat_id）</label>
              <input
                type="text"
                value={targetConversationId}
                onChange={(e) => setTargetConversationId(e.target.value)}
                placeholder="oc_abc123def456..."
                className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-muted-foreground text-[11px]">
                从 Feishu 获取群组或个人对话的 chat_id，用于接收定时任务的执行结果
              </p>
            </div>
          )}

          {/* Jitter — only for recurring schedules */}
          {scheduleType !== 'at' && (
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-medium">随机延迟（Jitter）</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setJitterEnabled((v) => !v)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    jitterEnabled ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                      jitterEnabled ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
                {jitterEnabled && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={jitterSec}
                      onChange={(e) => setJitterSec(e.target.value)}
                      className="border-border bg-background text-foreground w-20 rounded-lg border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-muted-foreground text-xs">秒</span>
                  </div>
                )}
              </div>
              <p className="text-muted-foreground text-[11px]">
                执行前随机等待 0 ~ {jitterEnabled ? jitterSec : '0'} 秒，避免多任务同时触发
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-500/5 p-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-4">
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-lg border px-4 py-1.5 text-xs transition-colors"
          >
            {t.settings.cronCancel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={cn(
              'bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors',
              loading && 'cursor-not-allowed opacity-50'
            )}
          >
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                {t.settings.cronCreating}
              </span>
            ) : (
              t.settings.cronCreate
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
