/**
 * MCP Memory Server
 *
 * 内置的 Streamable HTTP MCP 服务端，提供 search_memory 工具，
 * 让 Agent 能按需召回用户的历史对话原文。
 *
 * 协议：MCP 2025-06-18 (Streamable HTTP, JSON-only mode)
 * 端点：POST /mcp/memory?user_id=xxx
 * 工具：search_memory(query, limit?, days_back?)
 *
 * 数据流：
 *   Agent (SDK 内 LLM) → MCP client (SDK 内置)
 *     → POST /mcp/memory?user_id=xxx
 *       → JSON-RPC dispatch (initialize/tools/list/tools/call)
 *         → search_messages RPC (Supabase pgroonga)
 *           → 返回排序的 messages
 *
 * 安全模型：
 *   - sage-api 是 trusted backend，用 service_role key 直连 Supabase
 *   - user_id 由 sage-api 启动时（codeany/index.ts）作为 URL query 注入
 *   - 调 RPC 时显式传 user_id_filter，service_role 也只看到该用户的数据
 */

import { Hono } from 'hono';

import {
  getServiceSupabase,
  isSupabaseConfigured,
} from '@/shared/supabase/client';

// ─── MCP Tool Definition ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_memory',
    description:
      '搜索用户与 Sage 的历史对话原文（任意设备、任意时间）。\n\n' +
      '使用场景：当且仅当用户的提问明显依赖对你之前对话原文的查找时调用。\n' +
      '触发关键词示例：「我之前问过」「上次提到」「还记得我说过…吗」「上周/上次/那一次」。\n\n' +
      '不要因为下列情况调用本工具：\n' +
      '  - 用户问普通行情、资讯、新闻（用对应金融技能而非记忆）\n' +
      '  - 用户当前提问已带完整上下文，无需历史\n' +
      '  - 用户没有显式时间方位词或历史指代\n\n' +
      '返回：按相关度+时间倒序排列的历史 message，每条带 created_at 和原文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '搜索关键词。建议 2-6 个核心实词，pgroonga 中文分词会自动切分。' +
            '例如：「茅台 仓位」「深圳 天气」「分时图」。',
        },
        limit: {
          type: 'number',
          description: '返回条数（默认 10，上限 50）。',
          default: 10,
          minimum: 1,
          maximum: 50,
        },
        days_back: {
          type: 'number',
          description:
            '只搜索最近 N 天的消息。不传则搜索全部历史。' +
            '当用户提到「上周」「最近」「这个月」时建议传 7/30/30。',
        },
      },
      required: ['query'],
    },
  },
];

// ─── JSON-RPC Types ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function err(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

// ─── Tool: search_memory ────────────────────────────────────────────────────

interface SearchMemoryArgs {
  query?: unknown;
  limit?: unknown;
  days_back?: unknown;
}

interface SearchRow {
  id: string;
  task_id: string;
  type: string;
  content: string | null;
  created_at: string;
  rank: number;
}

async function callSearchMemory(
  args: SearchMemoryArgs,
  userId: string
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const query =
    typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new Error('参数 query 不能为空');
  }

  const limit =
    typeof args.limit === 'number' && args.limit > 0
      ? Math.min(Math.floor(args.limit), 50)
      : 10;

  const daysBack =
    typeof args.days_back === 'number' && args.days_back > 0
      ? Math.floor(args.days_back)
      : null;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('search_messages', {
    q: query,
    user_id_filter: userId,
    limit_n: limit,
    days_back: daysBack,
  });

  if (error) {
    throw new Error(`Supabase RPC failed: ${error.message}`);
  }

  const rows = (data ?? []) as SearchRow[];
  if (rows.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `未找到与「${query}」相关的历史会话。`,
        },
      ],
    };
  }

  // 把召回结果格式化为 markdown 给 LLM 阅读。
  // 时间统一转上海时区 (用户的实际生活时区) 并显式标注 "上海时间"，
  // 避免 LLM 把 UTC 当成本地时间念出来 (例如把中午 12:29 念成凌晨 04:29)。
  const lines: string[] = [
    `共找到 ${rows.length} 条相关历史消息（按相关度+时间倒序）。`,
    `**所有时间均为上海时间 (Asia/Shanghai, UTC+8)**，请直接引用，不要再做时区换算。`,
    '',
  ];
  for (const r of rows) {
    const dt = formatShanghai(r.created_at);
    const role = r.type === 'user' ? '用户' : 'Sage';
    const content = (r.content ?? '').slice(0, 500);
    lines.push(`---`);
    lines.push(`**[${dt}] ${role}** (task ${r.task_id.slice(0, 8)}, rank ${r.rank})`);
    lines.push(content || '_(空内容)_');
    lines.push('');
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

/**
 * 把 Postgres timestamptz (ISO-8601, 含时区偏移) 格式化为
 * "YYYY-MM-DD HH:mm:ss" 的上海时间字符串。
 *
 * 实现说明：之前用 toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })，
 * 但 pkg/Tauri sidecar 默认编译用 small-icu，sv-SE locale 会 fallback 成
 * en-US 格式（"4/30/2026, 12:29:02 PM"）。手动 +8h 拼接最稳，没有 ICU
 * 依赖，输出固定 ISO-like 格式让 LLM 直接复用。
 */
function formatShanghai(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const shanghai = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const yyyy = shanghai.getUTCFullYear();
    const mm = String(shanghai.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(shanghai.getUTCDate()).padStart(2, '0');
    const hh = String(shanghai.getUTCHours()).padStart(2, '0');
    const mi = String(shanghai.getUTCMinutes()).padStart(2, '0');
    const ss = String(shanghai.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  } catch {
    return iso;
  }
}

// ─── Hono App ───────────────────────────────────────────────────────────────

export const mcpMemoryRoutes = new Hono();

mcpMemoryRoutes.post('/', async (c) => {
  if (!isSupabaseConfigured()) {
    return c.json(
      err(null, ERR_INTERNAL, 'Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)'),
      200
    );
  }

  const userId = c.req.query('user_id');
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return c.json(
      err(null, ERR_INVALID_PARAMS, 'Missing or invalid ?user_id= query parameter (must be UUID)'),
      200
    );
  }

  let body: JsonRpcRequest;
  try {
    body = (await c.req.json()) as JsonRpcRequest;
  } catch {
    return c.json(err(null, ERR_PARSE, 'Invalid JSON body'), 200);
  }

  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json(err(body.id, ERR_INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request'), 200);
  }

  // ── Method dispatch ─────────────────────────────────────────────────────
  switch (body.method) {
    case 'initialize': {
      // 完整 MCP initialize handshake
      return c.json(
        ok(body.id, {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'sage-memory',
            version: '1.0.0',
          },
        })
      );
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress': {
      // 通知类（无需响应），但 JSON-RPC 服务器仍要回 200，body 给 null
      return new Response(null, { status: 202 });
    }

    case 'tools/list': {
      return c.json(ok(body.id, { tools: TOOLS }));
    }

    case 'tools/call': {
      const params = body.params ?? {};
      const name = params.name as string | undefined;
      const args = (params.arguments ?? {}) as SearchMemoryArgs;

      if (name !== 'search_memory') {
        return c.json(
          ok(body.id, {
            isError: true,
            content: [
              { type: 'text', text: `Unknown tool: ${name}` },
            ],
          })
        );
      }

      try {
        const result = await callSearchMemory(args, userId);
        return c.json(ok(body.id, result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[mcp-memory] search_memory failed:`, msg);
        return c.json(
          ok(body.id, {
            isError: true,
            content: [{ type: 'text', text: `search_memory error: ${msg}` }],
          })
        );
      }
    }

    case 'ping': {
      return c.json(ok(body.id, {}));
    }

    case 'resources/list':
    case 'prompts/list': {
      return c.json(ok(body.id, { resources: [], prompts: [] }));
    }

    default:
      return c.json(
        err(body.id, ERR_METHOD_NOT_FOUND, `Method not found: ${body.method}`)
      );
  }
});

// 一些 MCP client（如 Streamable HTTP spec 中的）会先做 GET 探测。
// 我们简单返回 200 + 空 SSE 流（或拒绝），因为不支持 server-initiated 消息。
mcpMemoryRoutes.get('/', (c) => {
  return c.text('MCP Memory server (POST JSON-RPC to this endpoint).', 200);
});
