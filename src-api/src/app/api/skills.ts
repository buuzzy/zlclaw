/**
 * Skills Configuration API Routes
 *
 * Manages per-skill enable/disable state.
 */

import { Hono } from 'hono';
import {
  getDisabledSkills,
  setSkillEnabled,
  saveSkillsConfig,
} from '@/shared/skills/config';
import {
  invalidateSkillRegistry,
  loadAndCacheSkills,
} from '@/shared/skills/predictor';

export const skillsRoutes = new Hono();

/**
 * Refresh in-memory caches whenever the persistent skills config changes.
 *
 * Without this the next agent turn would still see the old enabled/disabled
 * set: `cachedSkills` in predictor.ts is module-level and was loaded once
 * at startup, and the SDK skill registry would also stay frozen because
 * `refreshSkillsForPrompt` is now a one-shot populator (see predictor.ts).
 */
async function reloadSkillsAfterConfigChange(): Promise<void> {
  invalidateSkillRegistry();
  await loadAndCacheSkills(true);
}

/**
 * GET /skills/config — list disabled skills
 */
skillsRoutes.get('/config', (c) => {
  return c.json({ disabledSkills: getDisabledSkills() });
});

/**
 * POST /skills/config — bulk update disabled skills list
 */
skillsRoutes.post('/config', async (c) => {
  const body = await c.req.json<{ disabledSkills: string[] }>();
  if (!Array.isArray(body.disabledSkills)) {
    return c.json({ error: 'disabledSkills must be an array' }, 400);
  }
  saveSkillsConfig({ disabledSkills: body.disabledSkills });
  await reloadSkillsAfterConfigChange();
  return c.json({ ok: true, disabledSkills: body.disabledSkills });
});

/**
 * POST /skills/toggle — toggle a single skill
 */
skillsRoutes.post('/toggle', async (c) => {
  const body = await c.req.json<{ name: string; enabled: boolean }>();
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }
  setSkillEnabled(body.name, body.enabled);
  await reloadSkillsAfterConfigChange();
  return c.json({ ok: true, name: body.name, enabled: body.enabled });
});
