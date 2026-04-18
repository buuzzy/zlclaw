/**
 * Cron Jobs API Routes
 *
 * Provides CRUD endpoints for user-managed cron jobs.
 * The frontend settings panel uses these to display and edit the job list.
 * The Agent can also call these via the (future) cron tool.
 *
 * Endpoints:
 *   GET    /cron/jobs           — list all jobs
 *   POST   /cron/jobs           — create a new job
 *   GET    /cron/jobs/:id       — get a single job
 *   PUT    /cron/jobs/:id       — update a job
 *   DELETE /cron/jobs/:id       — remove a job (system jobs cannot be deleted)
 *   POST   /cron/jobs/:id/run   — manually trigger a job
 */

import { Hono } from 'hono';

import { listJobs, getJob } from '@/shared/cron/store';
import {
  addJob,
  patchJob,
  removeJob,
  runJobNow,
} from '@/shared/cron/scheduler';
import type { CronSchedule, DeliveryMode } from '@/shared/cron/types';

export const cronRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /cron/jobs
// ---------------------------------------------------------------------------

cronRoutes.get('/jobs', (c) => {
  const jobs = listJobs();
  return c.json({ ok: true, jobs });
});

// ---------------------------------------------------------------------------
// GET /cron/jobs/:id
// ---------------------------------------------------------------------------

cronRoutes.get('/jobs/:id', (c) => {
  const id = c.req.param('id');
  const job = getJob(id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json({ ok: true, job });
});

// ---------------------------------------------------------------------------
// POST /cron/jobs
// ---------------------------------------------------------------------------

interface CreateJobBody {
  name: string;
  prompt: string;
  schedule: CronSchedule;
  delivery?: DeliveryMode;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  targetConversationId?: string;
}

cronRoutes.post('/jobs', async (c) => {
  let body: CreateJobBody;
  try {
    body = await c.req.json<CreateJobBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.name?.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  if (!body.prompt?.trim()) {
    return c.json({ error: 'prompt is required' }, 400);
  }
  if (!body.schedule?.type) {
    return c.json({ error: 'schedule.type is required (cron | every | at)' }, 400);
  }

  // Validate schedule specifics
  const { schedule } = body;
  if (schedule.type === 'cron' && !schedule.expression) {
    return c.json({ error: 'schedule.expression is required for type=cron' }, 400);
  }
  if (schedule.type === 'every' && (!schedule.interval || schedule.interval < 1000)) {
    return c.json({ error: 'schedule.interval must be ≥ 1000 ms for type=every' }, 400);
  }
  if (schedule.type === 'at' && !schedule.at) {
    return c.json({ error: 'schedule.at is required for type=at' }, 400);
  }

  try {
    const job = addJob({
      name: body.name.trim(),
      prompt: body.prompt.trim(),
      schedule: body.schedule,
      delivery: body.delivery ?? 'none',
      enabled: body.enabled ?? true,
      deleteAfterRun: body.deleteAfterRun ?? false,
      targetConversationId: body.targetConversationId,
    });

    return c.json({ ok: true, job }, 201);
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create job',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /cron/jobs/:id
// ---------------------------------------------------------------------------

cronRoutes.put('/jobs/:id', async (c) => {
  const id = c.req.param('id');

  let body: Partial<CreateJobBody>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const job = getJob(id);
  if (!job) return c.json({ error: 'Job not found' }, 404);

  // Re-validate schedule if it's being updated
  if (body.schedule !== undefined) {
    const { schedule } = body;
    if (!schedule.type) {
      return c.json({ error: 'schedule.type is required (cron | every | at)' }, 400);
    }
    if (schedule.type === 'cron' && !schedule.expression) {
      return c.json({ error: 'schedule.expression is required for type=cron' }, 400);
    }
    if (schedule.type === 'every' && (!schedule.interval || schedule.interval < 1000)) {
      return c.json({ error: 'schedule.interval must be ≥ 1000 ms for type=every' }, 400);
    }
    if (schedule.type === 'at' && !schedule.at) {
      return c.json({ error: 'schedule.at is required for type=at' }, 400);
    }
  }

  const updated = patchJob(id, {
    ...(body.name !== undefined && { name: body.name.trim() }),
    ...(body.prompt !== undefined && { prompt: body.prompt.trim() }),
    ...(body.schedule !== undefined && { schedule: body.schedule }),
    ...(body.delivery !== undefined && { delivery: body.delivery }),
    ...(body.enabled !== undefined && { enabled: body.enabled }),
    ...(body.deleteAfterRun !== undefined && { deleteAfterRun: body.deleteAfterRun }),
    ...(body.targetConversationId !== undefined && { targetConversationId: body.targetConversationId }),
  });

  if (!updated) return c.json({ error: 'Job not found' }, 404);

  return c.json({ ok: true, job: updated });
});

// ---------------------------------------------------------------------------
// DELETE /cron/jobs/:id
// ---------------------------------------------------------------------------

cronRoutes.delete('/jobs/:id', (c) => {
  const id = c.req.param('id');

  const job = getJob(id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (job.system) return c.json({ error: 'System jobs cannot be deleted' }, 403);

  const removed = removeJob(id);
  if (!removed) return c.json({ error: 'Failed to remove job' }, 500);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /cron/jobs/:id/run  — manual trigger
// ---------------------------------------------------------------------------

cronRoutes.post('/jobs/:id/run', async (c) => {
  const id = c.req.param('id');

  const job = getJob(id);
  if (!job) return c.json({ error: 'Job not found' }, 404);

  try {
    const run = await runJobNow(id);
    return c.json({ ok: true, run });
  } catch (err) {
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Job execution failed',
    }, 500);
  }
});
