/**
 * Sage Prompt Loader
 *
 * Loads SOUL.md (persona) and AGENTS.md (workflow rules) from ~/.sage/
 * and combines them with the current date context into the Agent's
 * system prompt.
 *
 * Phase 2 onwards: 历史记忆**不再**通过 system prompt 注入。
 * Agent 通过 mcp__memory__search_memory 工具按需召回 supabase 云端的对话原文。
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { getAppDir } from '@/config/constants';

let cachedSoulPrompt: string | null = null;
let cachedAgentsPrompt: string | null = null;

async function loadFile(filename: string): Promise<string> {
  const filePath = join(getAppDir(), filename);
  if (!existsSync(filePath)) return '';
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`[PromptLoader] Failed to load ${filename}:`, error);
    return '';
  }
}

export async function getSoulPrompt(): Promise<string> {
  if (cachedSoulPrompt === null) {
    cachedSoulPrompt = await loadFile('SOUL.md');
  }
  return cachedSoulPrompt;
}

export async function getAgentsPrompt(): Promise<string> {
  if (cachedAgentsPrompt === null) {
    cachedAgentsPrompt = await loadFile('AGENTS.md');
  }
  return cachedAgentsPrompt;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDateContext(): string {
  const now = new Date();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dow = now.getDay();
  const dateStr = todayStr();
  const weekStr = weekDays[dow];
  // A/H shares trade Mon–Fri; weekend = market closed
  const isWeekend = dow === 0 || dow === 6;
  const marketNote = isWeekend
    ? '今天是休市日（周末），A股/港股不交易，最新行情数据为上一个交易日收盘数据。'
    : '今天是交易日，行情数据为当日实时或最新收盘数据。';
  return `# 当前日期\n今天是 ${dateStr}（${weekStr}）。${marketNote}`;
}

/**
 * Returns the combined Sage system prompt: dateContext + SOUL + AGENTS.
 *
 * 注意：从 Phase 2 起本函数不再接受/使用 userQuery。所有历史记忆召回
 * 都改走 Agent loop 中的 mcp__memory__search_memory 工具，不再走
 * system prompt 注入。这避免了「LLM 直接 direct_answer 不走 execute、
 * 工具永远不会被调」的死锁问题，也让所有记忆访问都可观测。
 */
export async function getSageSystemPrompt(): Promise<string> {
  const [soul, agents] = await Promise.all([
    getSoulPrompt(),
    getAgentsPrompt(),
  ]);

  const parts: string[] = [buildDateContext()];
  if (soul) parts.push(soul);
  if (agents) parts.push(agents);

  return parts.join('\n\n---\n\n') + '\n\n---\n\n';
}

export function invalidateCache(): void {
  cachedSoulPrompt = null;
  cachedAgentsPrompt = null;
}
