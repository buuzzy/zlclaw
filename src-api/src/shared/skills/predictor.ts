/**
 * Skill Registry — Static Full-Set Injection
 *
 * v1.3.1: switched from dynamic-subset to **static-full-set** registration.
 *
 * Why the change:
 *   The SDK's skill registry (`skills.set()` in
 *   `@codeany/open-agent-sdk/dist/skills/registry.js`) is a **module-level
 *   singleton**. Under concurrent requests, dynamically `clearSkills()` +
 *   register-N caused cross-request leakage: request A would render
 *   "Available skills: [X, Y]" in its system prompt, decide to invoke Y,
 *   then by the time the Skill tool actually executed, request B had
 *   replaced the registry with [Z, W] — A's invocation hit `getSkill(Y) →
 *   undefined` and erroneously reported "Unknown skill" with B's list.
 *
 * Trade-off:
 *   System prompt grows from ~150 tokens (3 selected) to ~850 tokens
 *   (~17 skills × 50 chars). Acceptable because:
 *     · Eliminates the entire class of concurrent-mutation bugs.
 *     · Improves model selection accuracy (sees full skill list, not a
 *       keyword-filtered subset that often misses the right tool).
 *     · Makes `refreshSkillsForPrompt()` idempotent — same registry
 *       state regardless of call order or interleaving.
 */

import {
  registerSkill,
  clearSkills,
  type SkillContentBlock,
} from '@codeany/open-agent-sdk';

import { loadAllSkills } from './loader';
import { getDisabledSkills } from './config';

// ============================================================================
// Types
// ============================================================================

interface CachedSkill {
  name: string;
  description: string;
  whenToUse: string;
  whenToUseKeywords: string[]; // split from comma-separated string
  argumentHint?: string;
  getPrompt: (args: string) => Promise<SkillContentBlock[]>;
}

// ============================================================================
// Module-level cache
// ============================================================================

/** All enabled skills, populated after first loadAndCache() call */
let cachedSkills: CachedSkill[] = [];

/** Whether the cache has been populated */
let cacheReady = false;

// ============================================================================
// Cache population
// ============================================================================

/**
 * Load all skills from filesystem and populate the module cache.
 * Safe to call multiple times; subsequent calls are no-ops unless force=true.
 */
export async function loadAndCacheSkills(force = false): Promise<void> {
  if (cacheReady && !force) return;

  const skills = await loadAllSkills();
  const disabled = new Set(getDisabledSkills());

  cachedSkills = skills
    .filter((s) => !disabled.has(s.name))
    .map((s) => {
      const description =
        s.metadata.promptDescription || s.metadata.description || s.name;

      const whenToUseRaw =
        s.metadata.whenToUse || s.metadata.description || '';

      const whenToUseKeywords = whenToUseRaw
        .split(/[,，\s]+/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);

      const content = s.content;
      const getPrompt = async (args: string): Promise<SkillContentBlock[]> => {
        const contextNote = args ? `\n\n## User Arguments\n${args}` : '';
        return [{ type: 'text', text: content + contextNote }];
      };

      return {
        name: s.name,
        description,
        whenToUse: whenToUseRaw,
        whenToUseKeywords,
        argumentHint: s.metadata.argumentHint,
        getPrompt,
      };
    });

  cacheReady = true;
}

// ============================================================================
// SDK registry refresh
// ============================================================================

/**
 * Track whether the registry has already been populated with the full
 * skill set. Once true, subsequent calls to `refreshSkillsForPrompt`
 * are no-ops — avoids unnecessary `clearSkills()`/re-register churn
 * that could leak between concurrent requests.
 */
let registryPopulated = false;

/**
 * Populate the SDK skill registry with **all** cached user-invocable skills.
 *
 * This used to be a dynamic per-prompt selector that registered a small
 * subset; see file-level docstring for why we now register the full set.
 *
 * Call this immediately before each `query()` invocation. After the first
 * successful registration the function becomes a no-op, since the registry
 * state is already what we want for every prompt.
 */
export async function refreshSkillsForPrompt(prompt: string): Promise<void> {
  await loadAndCacheSkills();

  if (cachedSkills.length === 0) return;

  if (registryPopulated) return;

  // First-time registration. We still call clearSkills() to evict any
  // SDK-bundled skills (`simplify`, `commit`, `review`, …) that may have
  // been auto-registered by other code paths — those are dev-tooling
  // skills irrelevant to the financial-assistant use case.
  clearSkills();

  for (const skill of cachedSkills) {
    registerSkill({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      argumentHint: skill.argumentHint,
      userInvocable: true,
      allowedTools: [
        'Bash',
        'Read',
        'Write',
        'Grep',
        'Glob',
        'WebFetch',
        'WebSearch',
      ],
      getPrompt: skill.getPrompt,
    });
  }

  registryPopulated = true;

  console.log(
    `[Skills/Predictor] Registered all ${cachedSkills.length} skill(s) (static full-set mode). First prompt: "${prompt.slice(0, 60)}..."`
  );
}

/**
 * Force a re-population on the next `refreshSkillsForPrompt` call.
 * Useful when skills config changes at runtime (e.g. user toggles
 * a skill on/off).
 */
export function invalidateSkillRegistry(): void {
  registryPopulated = false;
}

/**
 * Get the current cached skill count (for diagnostics).
 */
export function getCachedSkillCount(): number {
  return cachedSkills.length;
}
