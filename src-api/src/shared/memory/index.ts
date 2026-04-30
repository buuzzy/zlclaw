/**
 * MemoryProvider singleton + factory
 *
 * 进程级单例，按 process.env 推断当前部署上下文。
 * 未来要换实现（如 LocalSqliteMemoryProvider）只需改本文件，调用方不动。
 */

import type { MemoryProvider } from './provider';
import { SupabaseRpcMemoryProvider } from './supabase-rpc-provider';

let cached: MemoryProvider | null = null;

/**
 * 返回当前进程的默认 MemoryProvider。
 * 当前所有部署上下文都用 SupabaseRpcMemoryProvider；该 provider 内部
 * 按调用 ctx 自适应（有 accessToken → user-scoped；否则 service-role）。
 */
export function getMemoryProvider(): MemoryProvider {
  if (!cached) {
    cached = new SupabaseRpcMemoryProvider();
  }
  return cached;
}

export type {
  MemoryProvider,
  MemoryRecord,
  MemoryRequestContext,
  SearchOptions,
} from './provider';
