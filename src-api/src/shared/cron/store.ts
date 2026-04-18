/**
 * Cron Job Store
 *
 * Persists jobs to ~/.htclaw/cron/jobs.json.
 * Uses atomic write (write-to-temp + rename) to prevent corruption.
 * In-memory cache is always the source of truth; disk is flushed on every mutation.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import { nanoid } from 'nanoid';

import { getAppDir } from '@/config/constants';
import type { CronJob, CronRun, CronStore } from './types';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getCronDir(): string {
  return join(getAppDir(), 'cron');
}

function getJobsFilePath(): string {
  return join(getCronDir(), 'jobs.json');
}

function getTempPath(): string {
  return join(getCronDir(), 'jobs.json.tmp');
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

const EMPTY_STORE: CronStore = { version: 1, jobs: [] };

function ensureDir(): void {
  const dir = getCronDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readFromDisk(): CronStore {
  const path = getJobsFilePath();
  if (!existsSync(path)) return { ...EMPTY_STORE, jobs: [] };

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as CronStore;
    if (!Array.isArray(parsed.jobs)) parsed.jobs = [];
    return parsed;
  } catch (err) {
    console.error('[CronStore] Failed to parse jobs.json, starting with empty store:', err);
    return { ...EMPTY_STORE, jobs: [] };
  }
}

function flushToDisk(store: CronStore): void {
  try {
    ensureDir();
    const tmp = getTempPath();
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmp, getJobsFilePath());
  } catch (err) {
    console.error('[CronStore] Failed to write jobs.json:', err);
  }
}

// ---------------------------------------------------------------------------
// In-memory cache (hydrated on first access)
// ---------------------------------------------------------------------------

let _store: CronStore | null = null;

function getStore(): CronStore {
  if (!_store) {
    _store = readFromDisk();
  }
  return _store;
}

// ---------------------------------------------------------------------------
// Write serialization — ensures concurrent mutations never interleave
// ---------------------------------------------------------------------------

/**
 * All mutations that call save() go through this queue so that the sequence
 * "read _store → mutate → flushToDisk" is never interrupted by another
 * concurrent mutation. We maintain a simple promise chain; each new write
 * appends to the tail so saves are executed one-at-a-time in arrival order.
 */
let _writeQueue: Promise<void> = Promise.resolve();

function save(): void {
  _writeQueue = _writeQueue.then(() => {
    flushToDisk(getStore());
  }).catch((err) => {
    console.error('[CronStore] Write queue error:', err);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return a shallow copy of all jobs */
export function listJobs(): CronJob[] {
  return [...getStore().jobs];
}

/** Find a job by id */
export function getJob(id: string): CronJob | undefined {
  return getStore().jobs.find((j) => j.id === id);
}

/** Add a new job (assigns id + timestamps) */
export function addJob(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt' | 'runs'>): CronJob {
  const store = getStore();
  const now = new Date().toISOString();
  const newJob: CronJob = {
    ...job,
    id: nanoid(10),
    createdAt: now,
    updatedAt: now,
    runs: [],
  };
  store.jobs.push(newJob);
  save();
  console.log(`[CronStore] Added job: ${newJob.id} "${newJob.name}"`);
  return newJob;
}

/** Update an existing job (partial update) */
export function updateJob(id: string, patch: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob | null {
  const store = getStore();
  const idx = store.jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;

  store.jobs[idx] = {
    ...store.jobs[idx],
    ...patch,
    id,
    createdAt: store.jobs[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };
  save();
  return store.jobs[idx];
}

/**
 * Remove a job by id.
 * System jobs cannot be removed; call returns false in that case.
 */
export function removeJob(id: string): boolean {
  const store = getStore();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return false;
  if (job.system) {
    console.warn(`[CronStore] Cannot remove system job: ${id}`);
    return false;
  }
  store.jobs = store.jobs.filter((j) => j.id !== id);
  save();
  console.log(`[CronStore] Removed job: ${id}`);
  return true;
}

/** Append a run entry to a job's history (max 10 entries kept) */
export function appendRun(jobId: string, run: CronRun): void {
  const store = getStore();
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) return;

  if (!job.runs) job.runs = [];
  job.runs.push(run);
  if (job.runs.length > 10) job.runs = job.runs.slice(-10);

  job.lastRunAt = run.startedAt;
  job.updatedAt = new Date().toISOString();
  save();
}

/** Upsert a job by id — used by system job registration */
export function upsertJob(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt' | 'runs'> & { id: string }): CronJob {
  const store = getStore();
  const existing = store.jobs.find((j) => j.id === job.id);
  const now = new Date().toISOString();

  if (existing) {
    // Update but keep run history and createdAt; enforce runs limit
    const existingRuns = existing.runs ?? [];
    const trimmedRuns = existingRuns.length > 10 ? existingRuns.slice(-10) : existingRuns;
    Object.assign(existing, { ...job, updatedAt: now, runs: trimmedRuns });
    save();
    return existing;
  }

  const newJob: CronJob = { ...job, createdAt: now, updatedAt: now, runs: [] };
  store.jobs.push(newJob);
  save();
  console.log(`[CronStore] Upserted system job: ${newJob.id} "${newJob.name}"`);
  return newJob;
}
