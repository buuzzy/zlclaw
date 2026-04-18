/**
 * Intent Predictor — Dynamic Skill Registry
 *
 * Analyzes the user's prompt against each skill's `whenToUse` keywords
 * and refreshes the SDK skill registry with only the relevant skills
 * before each query turn.
 *
 * Token budget:
 *   - All skills registered (cold start): ~15 × 40 chars ≈ 600 chars (~150 tokens)
 *   - Dynamic (1-3 matched skills): ~3 × 40 chars ≈ 120 chars (~30 tokens)
 *   - Fallback cold-start set: 3 baseline skills injected when nothing matches
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

/**
 * Cold-start skills: always include these when nothing else matches.
 * Covers the three most frequently needed domains so the model always
 * has useful tools on turn 1 even with an ambiguous prompt.
 */
const COLD_START_SKILL_NAMES = [
  '行情数据查询',  // iwencai stock quote — most common query type
  '新闻搜索',      // news search — second most common
  'westock-quote', // tencent quote — covers price/chart intent
];

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
// Scoring
// ============================================================================

/**
 * Score a skill against a prompt.
 * Returns an integer hit count (0 = no match).
 */
function scoreSkill(skill: CachedSkill, normalizedPrompt: string): number {
  let score = 0;
  for (const kw of skill.whenToUseKeywords) {
    if (normalizedPrompt.includes(kw)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Select skills relevant to the given prompt.
 *
 * Strategy:
 * 1. Score every skill by keyword overlap with the prompt.
 * 2. Return all skills with score > 0, sorted by score descending, capped at `maxSkills`.
 * 3. If nothing matches, return the cold-start baseline set.
 */
function selectRelevantSkills(
  prompt: string,
  maxSkills = 5
): CachedSkill[] {
  const normalized = prompt.toLowerCase();

  const scored = cachedSkills
    .map((skill) => ({ skill, score: scoreSkill(skill, normalized) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSkills)
    .map(({ skill }) => skill);

  if (scored.length > 0) {
    return scored;
  }

  // No matches — return cold-start baseline
  const baseline = COLD_START_SKILL_NAMES
    .map((name) => cachedSkills.find((s) => s.name === name))
    .filter((s): s is CachedSkill => s !== undefined);

  // If cold-start names aren't available (e.g., different skill set), return first 3
  return baseline.length > 0 ? baseline : cachedSkills.slice(0, 3);
}

// ============================================================================
// SDK registry refresh
// ============================================================================

/**
 * Re-register the SDK skill registry with only the skills relevant to `prompt`.
 *
 * Call this immediately before each `query()` invocation.
 * Thread-safety note: this function is synchronous after the async loadAndCacheSkills()
 * setup — safe for single-threaded Node.js event loop.
 */
export async function refreshSkillsForPrompt(prompt: string): Promise<void> {
  // Ensure cache is ready (no-op after first call)
  await loadAndCacheSkills();

  if (cachedSkills.length === 0) return;

  const selected = selectRelevantSkills(prompt);

  // Swap out the registry
  clearSkills();

  for (const skill of selected) {
    registerSkill({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      argumentHint: skill.argumentHint,
      userInvocable: true,
      allowedTools: ['Bash', 'Read', 'Write', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
      getPrompt: skill.getPrompt,
    });
  }

  const names = selected.map((s) => s.name).join(', ');
  console.log(
    `[Skills/Predictor] Injected ${selected.length}/${cachedSkills.length} skill(s) for prompt: "${prompt.slice(0, 60)}..." → [${names}]`
  );
}

/**
 * Get the current cached skill count (for diagnostics).
 */
export function getCachedSkillCount(): number {
  return cachedSkills.length;
}
