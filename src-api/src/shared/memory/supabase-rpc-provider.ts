/**
 * SupabaseRpcMemoryProvider
 *
 * 用 supabase.rpc('search_messages') 召回历史消息，支持两种鉴权模式：
 *
 *   1. user-scoped 模式（默认，桌面端 sidecar 用）
 *      - ctx.accessToken 不为空 → 用 anon key + 用户 JWT 创建临时 client
 *      - 受 RLS 保护，函数内部 COALESCE(auth.uid(), user_id_filter) 强制用 auth.uid()
 *      - 用户即使在 user_id_filter 里传别人 uid 也无效（物理隔离）
 *      - 桌面端 .env 不需要 service role key，零 god-mode 暴露
 *
 *   2. service-role 模式（Railway 等受控服务器）
 *      - ctx.accessToken 为空 + service role 已配置 → 用 service-role client
 *      - 绕过 RLS，按 ctx.userId 显式过滤
 *      - 用于 iOS / Web 等未来场景：前端传 userId，Railway sage-api 用
 *        service role 拉数据
 *
 * 任何模式都通过同一个 search_messages RPC，返回数据结构一致。
 */

import {
  createUserScopedSupabase,
  getServiceSupabase,
} from '@/shared/supabase/client';
import type {
  MemoryProvider,
  MemoryRecord,
  MemoryRequestContext,
  SearchOptions,
} from './provider';

interface RawRow {
  id: string;
  task_id: string;
  type: string;
  content: string | null;
  created_at: string;
  rank: number;
}

const DEFAULT_LIMIT = 10;
const HARD_LIMIT = 50;

export class SupabaseRpcMemoryProvider implements MemoryProvider {
  async search(
    query: string,
    ctx: MemoryRequestContext,
    options: SearchOptions = {}
  ): Promise<MemoryRecord[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const limit =
      typeof options.limit === 'number' && options.limit > 0
        ? Math.min(Math.floor(options.limit), HARD_LIMIT)
        : DEFAULT_LIMIT;

    const daysBack =
      typeof options.daysBack === 'number' && options.daysBack > 0
        ? Math.floor(options.daysBack)
        : null;

    const timeStart =
      typeof options.timeStart === 'string' && options.timeStart.length > 0
        ? options.timeStart
        : null;
    const timeEnd =
      typeof options.timeEnd === 'string' && options.timeEnd.length > 0
        ? options.timeEnd
        : null;
    const roleFilter =
      options.roleFilter && options.roleFilter !== 'all'
        ? options.roleFilter
        : null;

    const client = ctx.accessToken
      ? createUserScopedSupabase(ctx.accessToken)
      : getServiceSupabase();

    const { data, error } = await client.rpc('search_messages', {
      q: trimmed,
      user_id_filter: ctx.userId,
      limit_n: limit,
      days_back: daysBack,
      time_start: timeStart,
      time_end: timeEnd,
      role_filter: roleFilter,
    });

    if (error) {
      throw new Error(`Supabase RPC search_messages failed: ${error.message}`);
    }

    return ((data ?? []) as RawRow[]).map((r) => ({
      id: r.id,
      taskId: r.task_id,
      type: r.type,
      content: r.content,
      createdAt: r.created_at,
      rank: r.rank,
    }));
  }
}
