/**
 * Cron Scheduler
 *
 * Manages the lifecycle of all cron jobs:
 *   - Loads persisted jobs from the store on startup
 *   - Registers node-cron tasks for `cron`-type schedules
 *   - Handles `every`-type schedules with setInterval
 *   - Handles `at`-type one-shot schedules with setTimeout
 *   - Runs each job in an isolated Agent session (full tool access)
 *   - Pushes result to channel if delivery mode is 'channel'
 *
 * The scheduler is a singleton started in src/index.ts.
 */

import cron from 'node-cron';
import { nanoid } from 'nanoid';

import { getProviderManager } from '@/shared/provider/manager';
import {
  listJobs,
  getJob,
  addJob as storeAddJob,
  updateJob,
  removeJob as storeRemoveJob,
  appendRun,
  upsertJob,
} from './store';
import type { CronJob, CronRun, CronSchedule, DeliveryMode } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddJobInput {
  name: string;
  prompt: string;
  schedule: CronSchedule;
  delivery?: DeliveryMode;
  /** Target conversationId for channel delivery (e.g. Feishu chat_id). */
  targetConversationId?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  /** Max random delay before each run (ms). Defaults to 30 000. Set 0 to disable. */
  jitter?: number;
}

// ---------------------------------------------------------------------------
// Internal: active task handles
// ---------------------------------------------------------------------------

interface TaskHandle {
  type: 'cron' | 'interval' | 'timeout';
  destroy: () => void;
}

const handles = new Map<string, TaskHandle>();

// ---------------------------------------------------------------------------
// Jitter helper
// ---------------------------------------------------------------------------

/** Default max jitter for non-system recurring jobs (30 s) */
const DEFAULT_JITTER_MS = 30_000;

/**
 * Returns the effective jitter ceiling for a job.
 * System jobs and one-shot (`at`) jobs always get 0 jitter.
 */
function getJitter(job: CronJob): number {
  if (job.system || job.schedule.type === 'at') return 0;
  if (job.jitter !== undefined) return Math.max(0, job.jitter);
  return DEFAULT_JITTER_MS;
}

/**
 * Wraps an executor function with a random delay in [0, maxJitter] ms.
 * If maxJitter is 0 the executor is called synchronously (no overhead).
 */
function withJitter(maxJitter: number, fn: () => void): () => void {
  if (maxJitter <= 0) return fn;
  return () => {
    const delay = Math.floor(Math.random() * maxJitter);
    if (delay === 0) {
      fn();
    } else {
      setTimeout(fn, delay);
    }
  };
}

// ---------------------------------------------------------------------------
// Isolated agent run
// ---------------------------------------------------------------------------

/**
 * Run the job prompt in an isolated Agent session.
 * Returns the final assistant reply (truncated to 500 chars for history).
 */
async function runJobPrompt(job: CronJob): Promise<string> {
  // Dynamically import to avoid circular dependency at module load time
  const { createSession, runAgent } = await import('@/shared/services/agent');

  const providerManager = getProviderManager();
  const agentCfg = providerManager.getConfig().agent?.config as Record<string, unknown> | undefined;

  const modelConfig = agentCfg
    ? {
        apiKey: agentCfg.apiKey as string | undefined,
        baseUrl: agentCfg.baseUrl as string | undefined,
        model: agentCfg.model as string | undefined,
        apiType: agentCfg.apiType as 'anthropic-messages' | 'openai-completions' | undefined,
      }
    : undefined;

  const session = createSession('execute');

  let output = '';
  try {
    for await (const msg of runAgent(
      job.prompt,
      session,
      [], // no conversation history — isolated run
      undefined, // workDir
      undefined, // taskId
      modelConfig,
    )) {
      if ((msg.type === 'text' || msg.type === 'direct_answer') && (msg as any).content) {
        output += (msg as any).content + '\n';
      }
    }
  } catch (err) {
    throw err;
  }

  return output.trim().slice(0, 500);
}

// ---------------------------------------------------------------------------
// Job execution wrapper
// ---------------------------------------------------------------------------

async function executeJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.enabled) return;

  const startedAt = new Date().toISOString();
  console.log(`[Cron] Running job: ${jobId} "${job.name}"`);

  // For consolidated memory jobs that have their own implementation:
  if (job.system && job.id === 'sys-memory-consolidation') {
    const run: CronRun = { startedAt, status: 'running' };
    try {
      const { consolidateDailyMemory } = await import('@/shared/memory/consolidator');
      const result = await consolidateDailyMemory();
      const output = `Processed: ${result.processed.join(', ') || 'none'}, Skipped: ${result.skipped.length}, Failed: ${result.failed.join(', ') || 'none'}`;
      run.finishedAt = new Date().toISOString();
      // If any dates failed to consolidate, mark the run as failed rather than success
      run.status = result.failed.length > 0 ? 'failed' : 'success';
      run.output = output;
      if (result.failed.length > 0) {
        run.error = `Consolidation failed for: ${result.failed.join(', ')}`;
      }
      console.log(`[Cron] Job ${jobId} completed: ${output}`);
    } catch (err) {
      run.finishedAt = new Date().toISOString();
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Job ${jobId} failed:`, err);
    }
    appendRun(jobId, run);
    return;
  }

  // Generic isolated agent run
  const run: CronRun = { startedAt, status: 'running' };
  try {
    const output = await runJobPrompt(job);
    run.finishedAt = new Date().toISOString();
    run.status = 'success';
    run.output = output;
    console.log(`[Cron] Job ${jobId} completed successfully`);

    // Push to channel if delivery mode is 'channel'
    if (job.delivery === 'channel' && output) {
      pushToChannel(job, output).catch((err) =>
        console.warn(`[Cron] Channel delivery failed for job ${jobId}:`, err)
      );
    }
  } catch (err) {
    run.finishedAt = new Date().toISOString();
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
    console.error(`[Cron] Job ${jobId} failed:`, err);
  }

  appendRun(jobId, run);

  // One-shot: clean up after run regardless of success/failure
  // (a failed one-shot should not retry on next scheduler tick)
  if (job.deleteAfterRun) {
    unscheduleJob(jobId);
    storeRemoveJob(jobId);
    console.log(`[Cron] One-shot job ${jobId} deleted after run (status: ${run.status})`);
  }
}

// ---------------------------------------------------------------------------
// Channel delivery
// ---------------------------------------------------------------------------

async function pushToChannel(job: CronJob, output: string): Promise<void> {
  const conversationId = job.targetConversationId;
  if (!conversationId) {
    console.warn(`[Cron] Job "${job.name}" has delivery=channel but no targetConversationId — skipping push`);
    return;
  }

  const { getChannelManager } = await import('@/core/channel/manager');
  const adapter = getChannelManager().getAdapter('feishu');
  if (!adapter) {
    console.warn(`[Cron] Channel delivery: feishu adapter not registered (is Feishu configured?)`);
    return;
  }

  const MAX_ATTEMPTS = 3;
  const BACKOFF_BASE_MS = 1_000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await adapter.send({ conversationId, content: output });
      console.log(`[Cron] Channel delivery succeeded for job "${job.name}" → ${conversationId}`);
      return;
    } catch (err) {
      const isLast = attempt === MAX_ATTEMPTS;
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(
        `[Cron] Channel delivery attempt ${attempt}/${MAX_ATTEMPTS} failed for job "${job.name}":`,
        err instanceof Error ? err.message : err,
        isLast ? '— giving up' : `— retrying in ${delay}ms`
      );
      if (isLast) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

function unscheduleJob(jobId: string): void {
  const handle = handles.get(jobId);
  if (handle) {
    handle.destroy();
    handles.delete(jobId);
  }
}

function scheduleJob(job: CronJob): void {
  if (!job.enabled) return;

  unscheduleJob(job.id); // Clear any existing handle first

  const { schedule } = job;

  if (schedule.type === 'cron') {
    if (!schedule.expression) {
      console.warn(`[Cron] Job ${job.id} has no cron expression, skipping`);
      return;
    }

    const valid = cron.validate(schedule.expression);
    if (!valid) {
      console.warn(`[Cron] Invalid cron expression for job ${job.id}: "${schedule.expression}"`);
      return;
    }

    try {
      const jitteredExecute = withJitter(getJitter(job), () => executeJob(job.id));
      const task = cron.schedule(
        schedule.expression,
        jitteredExecute,
        { timezone: schedule.timezone || 'Asia/Shanghai' }
      );

      handles.set(job.id, {
        type: 'cron',
        destroy: () => task.stop(),
      });

      const jitterNote = getJitter(job) > 0 ? ` (jitter ≤${getJitter(job) / 1000}s)` : '';
      console.log(`[Cron] Scheduled job "${job.name}" (${job.id}) — cron: ${schedule.expression}${jitterNote}`);
    } catch (err) {
      console.error(`[Cron] Failed to register cron job "${job.name}" (${job.id}):`, err);
      return;
    }

  } else if (schedule.type === 'every') {
    if (!schedule.interval || schedule.interval < 1000) {
      console.warn(`[Cron] Job ${job.id} has invalid interval: ${schedule.interval}`);
      return;
    }

    const jitteredExecute = withJitter(getJitter(job), () => executeJob(job.id));
    const timer = setInterval(jitteredExecute, schedule.interval);

    handles.set(job.id, {
      type: 'interval',
      destroy: () => clearInterval(timer),
    });

    const jitterNote = getJitter(job) > 0 ? ` (jitter ≤${getJitter(job) / 1000}s)` : '';
    console.log(`[Cron] Scheduled job "${job.name}" (${job.id}) — every ${schedule.interval}ms${jitterNote}`);

  } else if (schedule.type === 'at') {
    if (!schedule.at) {
      console.warn(`[Cron] Job ${job.id} has no 'at' timestamp`);
      return;
    }

    const fireAt = new Date(schedule.at).getTime();
    const delay = fireAt - Date.now();

    if (delay <= 0) {
      console.warn(`[Cron] One-shot job ${job.id} target time is in the past, skipping`);
      return;
    }

    const timer = setTimeout(() => executeJob(job.id), delay);

    handles.set(job.id, {
      type: 'timeout',
      destroy: () => clearTimeout(timer),
    });

    console.log(`[Cron] Scheduled one-shot job "${job.name}" (${job.id}) — at ${schedule.at}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load all persisted jobs and schedule enabled ones. Called once at startup. */
export function initScheduler(): void {
  // Register the F25 system job (memory consolidation)
  upsertJob({
    id: 'sys-memory-consolidation',
    name: '每日记忆归纳 (F25)',
    prompt: '', // handled by dedicated consolidateDailyMemory() call
    schedule: { type: 'cron', expression: '0 23 * * *', timezone: 'Asia/Shanghai' },
    delivery: 'none',
    enabled: true,
    system: true,
  });

  const jobs = listJobs();
  let scheduled = 0;

  for (const job of jobs) {
    if (job.enabled) {
      try {
        scheduleJob(job);
        scheduled++;
      } catch (err) {
        console.error(`[Cron] Failed to schedule job "${job.name}" (${job.id}) at startup:`, err);
      }
    }
  }

  console.log(`[Cron] Scheduler initialized — ${jobs.length} job(s) loaded, ${scheduled} scheduled`);
}

/** Add a new job and schedule it immediately */
export function addJob(input: AddJobInput): CronJob {
  const job = storeAddJob({
    name: input.name,
    prompt: input.prompt,
    schedule: input.schedule,
    delivery: input.delivery ?? 'none',
    targetConversationId: input.targetConversationId,
    enabled: input.enabled ?? true,
    deleteAfterRun: input.deleteAfterRun ?? false,
    jitter: input.jitter,
  });

  if (job.enabled) {
    scheduleJob(job);
  }

  return job;
}

/** Update a job and reschedule it */
export function patchJob(id: string, patch: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob | null {
  const updated = updateJob(id, patch);
  if (!updated) return null;

  // Reschedule — handles enabled toggling and schedule changes
  unscheduleJob(id);
  if (updated.enabled) {
    scheduleJob(updated);
  }

  return updated;
}

/** Remove a job and cancel its schedule */
export function removeJob(id: string): boolean {
  unscheduleJob(id);
  return storeRemoveJob(id);
}

/** Manually trigger a job immediately (regardless of schedule) */
export async function runJobNow(id: string): Promise<CronRun> {
  const job = getJob(id);
  if (!job) throw new Error(`Job not found: ${id}`);

  const startedAt = new Date().toISOString();
  console.log(`[Cron] Manual run triggered for job: ${id} "${job.name}"`);

  await executeJob(id);

  // Return the latest run entry
  const updated = getJob(id);
  const lastRun = updated?.runs?.slice(-1)[0];
  return lastRun ?? { startedAt, finishedAt: new Date().toISOString(), status: 'success' };
}

/** Stop all scheduled jobs (called on server shutdown) */
export function shutdownScheduler(): void {
  for (const [id, handle] of handles.entries()) {
    handle.destroy();
    console.log(`[Cron] Stopped job: ${id}`);
  }
  handles.clear();
  console.log('[Cron] Scheduler shutdown complete');
}
