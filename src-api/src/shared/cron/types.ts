/**
 * Cron System — Type Definitions
 *
 * HTclaw supports user-manageable scheduled tasks. Jobs are persisted to
 * ~/.htclaw/cron/jobs.json and can be created via:
 *   - The REST API (frontend settings panel)
 *   - Natural language (Agent calling the cron tool in future iteration)
 *
 * Design: simplified adaptation of OpenClaw's cron architecture, tailored
 * for HTclaw's financial assistant use-case.
 */

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * `cron`  — standard 5-field cron expression (e.g. "0 9 * * 1-5")
 * `every` — repeat interval in milliseconds (e.g. 3_600_000 for hourly)
 * `at`    — one-shot ISO-8601 timestamp (e.g. "2026-04-18T09:15:00+08:00")
 */
export type ScheduleType = 'cron' | 'every' | 'at';

export interface CronSchedule {
  type: ScheduleType;
  /** cron expression — required when type === "cron" */
  expression?: string;
  /** interval ms — required when type === "every" */
  interval?: number;
  /** ISO-8601 datetime — required when type === "at" */
  at?: string;
  /** IANA timezone (e.g. "Asia/Shanghai") — used when type === "cron" */
  timezone?: string;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * `none`    — run silently; result stored in job history only
 * `channel` — push result to configured channel (Feishu / WeChat)
 */
export type DeliveryMode = 'none' | 'channel';

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export interface CronJob {
  /** Unique identifier (nanoid) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Natural-language prompt executed by the isolated Agent run */
  prompt: string;

  schedule: CronSchedule;

  delivery: DeliveryMode;

  /** Whether this job is active */
  enabled: boolean;

  /**
   * System jobs (e.g. F25 memory consolidation) are created by HTclaw itself.
   * They cannot be deleted by the user but can be disabled.
   */
  system?: boolean;

  /** Delete after first successful run (one-shot jobs via `at`) */
  deleteAfterRun?: boolean;

  /**
   * Max random delay (ms) added before each execution to prevent thundering herd.
   * Actual delay is a uniform random value in [0, jitter].
   * Defaults to 30_000 (30s) for cron/every jobs; 0 for system and one-shot jobs.
   * Set to 0 to disable.
   */
  jitter?: number;

  /**
   * Target conversationId for channel delivery (e.g. Feishu chat_id).
   * Required when delivery === 'channel'; ignored otherwise.
   */
  targetConversationId?: string;

  /** ISO-8601 timestamps */
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;

  /** History of recent runs (max 10) */
  runs?: CronRun[];
}

// ---------------------------------------------------------------------------
// Run history
// ---------------------------------------------------------------------------

export type RunStatus = 'success' | 'failed' | 'running';

export interface CronRun {
  /** ISO-8601 */
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  /** Truncated agent output (max 500 chars) */
  output?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Store shape (jobs.json)
// ---------------------------------------------------------------------------

export interface CronStore {
  version: 1;
  jobs: CronJob[];
}
