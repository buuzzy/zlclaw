/**
 * MemoryProvider 抽象
 *
 * 把「记忆召回」这一能力从具体存储实现里抽出来，让 mcp-memory tool 处理逻辑
 * 与底层数据源解耦。这样未来加 iOS、加本地 SQLite 召回、加 Edge Function
 * 中转等都不需要改 tool 的协议层。
 *
 * 当前实现：
 *   - SupabaseRpcMemoryProvider：双模式（service-role 走 Railway，user-JWT 走桌面）
 *
 * 未来可能的实现：
 *   - LocalSqliteMemoryProvider：桌面端读 ~/.sage/users/{uid}/sage.db
 *   - RemoteHttpMemoryProvider：通过自家 BFF 中转（access token 模式）
 */

export interface MemoryRecord {
  id: string;
  taskId: string;
  type: string;
  content: string | null;
  createdAt: string;
  rank: number;
}

export interface SearchOptions {
  limit?: number;
  daysBack?: number | null;
  /** ISO timestamp，开始时间（含） */
  timeStart?: string | null;
  /** ISO timestamp，结束时间（含） */
  timeEnd?: string | null;
  /** 角色筛选：'user' | 'assistant' | 'all'。'all' / null = 不筛 */
  roleFilter?: 'user' | 'assistant' | 'all' | null;
}

export interface MemoryRequestContext {
  /** Supabase auth.uid()，必须由调用方传入 */
  userId: string;
  /** 当前用户的 supabase access token（可选，user-scoped 模式必需） */
  accessToken?: string;
}

export interface MemoryProvider {
  search(
    query: string,
    ctx: MemoryRequestContext,
    options?: SearchOptions
  ): Promise<MemoryRecord[]>;
}
