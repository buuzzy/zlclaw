/**
 * Behavior Sync — 本地 user message → 云端 public.user_behavior 的火忘式双写
 *
 * L4-light 行为日志层（参见 supabase/migrations/20260501050000_user_behavior.sql）。
 * 复用现有 messages-sync 的 sync_queue 机制：每次 user message 写入时
 * 同步入队一条 user_behavior insert。
 *
 * 字段提取策略：
 *   • query_hash    — sha256(content)[0:32]，用于去重和频率统计
 *   • query_preview — content 前 200 字符明文，便于审计
 *   • skill_used    — null（写入时还不知道，由蒸馏 cron 从 messages.tool 聚合）
 *   • asset_mentions — 严格正则匹配带前缀/后缀的标的代码（避免误伤）
 *
 * 注意：仅记录 `type === 'user'` 的消息。Agent 输出 / tool 调用不入这个表。
 */

import type { Message } from '@/shared/db/types';

import { enqueueSync } from './sync-queue';

// ─── Hash helpers ────────────────────────────────────────────────────────────

/**
 * sha256(input) → 前 16 字节十六进制字符串（32 字符）。
 *
 * 浏览器 / Tauri WebView / iOS WKWebView 都自带 crypto.subtle，桌面端
 * Vite 同样可用。无 polyfill 风险。
 */
async function sha256Hex16(input: string): Promise<string> {
  if (!input) return '';
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
    const arr = new Uint8Array(buf).slice(0, 16);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.warn('[behavior-sync] sha256 failed:', err);
    return '';
  }
}

// ─── Asset mention extractor ─────────────────────────────────────────────────

/**
 * 从 query 文本中匹配标的代码。严格匹配带前缀/后缀的形式，避免把
 * 任意 6 位数字（订单号、日期等）误认为 A 股代码。
 *
 * 支持：
 *   • A 股：sh600519 / sz000001 / 600519.SH / 000001.SZ → 输出 "sh600519" / "sz000001"
 *   • 港股：00700.HK / 0700.HK → 输出 "00700.HK"
 *
 * 输出最多 10 条（防止边角恶意输入炸 prompt）。
 */
function extractAssetMentions(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();

  // A 股前缀形式：sh600519 / SZ 000001
  const reAStockPrefix = /(?:^|[\s,.;:!?(\[\u3000])(sh|sz|SH|SZ)\s*0*(\d{6})\b/g;
  for (const m of text.matchAll(reAStockPrefix)) {
    if (m[1] && m[2]) out.add(m[1].toLowerCase() + m[2]);
  }

  // A 股后缀形式：600519.SH / 000001.sz
  const reAStockSuffix = /\b0*(\d{6})\.(SH|SZ|sh|sz)\b/g;
  for (const m of text.matchAll(reAStockSuffix)) {
    if (m[1] && m[2]) out.add(m[2].toLowerCase() + m[1]);
  }

  // 港股：4-5 位数字 + .HK
  const reHK = /\b(\d{4,5})\.(?:HK|hk)\b/g;
  for (const m of text.matchAll(reHK)) {
    if (m[1]) out.add(m[1].padStart(5, '0') + '.HK');
  }

  return Array.from(out).slice(0, 10);
}

// ─── Build payload ───────────────────────────────────────────────────────────

const QUERY_PREVIEW_MAX = 200;

async function buildBehaviorPayload(
  msg: Message
): Promise<Record<string, unknown> | null> {
  const content = (msg.content ?? '').trim();
  if (!content) return null;

  const queryHash = await sha256Hex16(content);
  const queryPreview = content.slice(0, QUERY_PREVIEW_MAX);
  const assetMentions = extractAssetMentions(content);

  return {
    user_id: msg.user_id,
    ts: msg.created_at,
    task_id: msg.task_id,
    query_hash: queryHash || null,
    query_preview: queryPreview || null,
    skill_used: null,
    asset_mentions: assetMentions.length > 0 ? assetMentions : null,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 把一条本地写好的 user message 入云端 user_behavior 同步队列。
 * 调用方在本地 INSERT message 成功后调（不 await，火忘）。
 *
 * 仅 type === 'user' 的 message 会入队；其他 type（assistant / tool 等）静默跳过。
 */
export function enqueueUserBehavior(msg: Message): void {
  if (msg.type !== 'user') return;

  void (async () => {
    try {
      const payload = await buildBehaviorPayload(msg);
      if (!payload) return;
      await enqueueSync('user_behavior', 'insert', payload);
    } catch (err) {
      console.error('[behavior-sync] enqueue failed:', err);
    }
  })();
}

/** 单元测试用 export — 不在生产代码使用 */
export const __testables = { extractAssetMentions, sha256Hex16 };
