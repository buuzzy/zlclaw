/**
 * MCP Memory Server
 *
 * 内置的 Streamable HTTP MCP 服务端，提供 search_memory 工具，
 * 让 Agent 能按需召回用户的历史对话原文。
 *
 * 协议：MCP 2025-06-18 (Streamable HTTP, JSON-only mode)
 * 端点：POST /mcp/memory?user_id=xxx[&access_token=xxx]
 * 工具：search_memory(query, limit?, days_back?)
 *
 * 鉴权与数据访问：
 *   - 调用方（codeany 内的 SDK MCP client）通过 query string 传 user_id
 *     和可选 access_token。
 *   - 实际数据访问委托给 MemoryProvider，按 ctx 自适应：
 *     * 桌面端 sidecar：access_token 必传 → user-scoped client（anon + JWT），
 *       受 RLS 强制隔离，无 service role 暴露。
 *     * Railway 等服务器：access_token 可选 → 退化为 service-role client，
 *       绕 RLS 但应用层手动按 user_id 过滤。
 *
 * 请求只在 sage-api 进程的 loopback / Bearer-protected 范围内流动，
 * access_token 不会出现在外部网络日志中。
 */

import { Hono } from 'hono';

import { getMemoryProvider } from '@/shared/memory';
import { isSupabaseConfigured } from '@/shared/supabase/client';

// ─── MCP Tool Definition ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_memory',
    description:
      '检索本用户在 Sage 上的历史对话原文（长尾档案查询，非常规召回工具）。\n\n' +
      '## ⚠️ 你已经认识这位用户\n' +
      '系统在每次对话开始前，已经把用户画像（硬规则、偏好、关注标的）和\n' +
      '最近 20 个对话回合预注入进了你的 system prompt。绝大多数问题应当直接\n' +
      '基于预注入回答，不要调本工具。\n\n' +
      '## 应当调用的场景\n' +
      '只在以下情形调用——用户在「主动追问」具体历史细节：\n' +
      '  · 用户要求查找具体历史原文（"我之前对比亚迪怎么看的？"、"那篇研报链接是什么"）\n' +
      '  · 用户提到的事件/标的明显在 20 个回合之外（"3月份"、"我去年清仓的那只票"）\n' +
      '  · 用户索取 agent 当时给出的具体内容（清单、地址、观点原文）\n\n' +
      '## 不应调用的场景\n' +
      '  · 用户问的是已在 persona 中的规则/偏好（"我设定过几条投资原则吗"）→ 直接基于预注入回答\n' +
      '  · 用户问的是最近几轮对话内容 → 已在预注入的 recent_threads，直接回答\n' +
      '  · 行情/新闻/数据查询（用对应金融技能，不查历史）\n' +
      '  · 闲聊或公共常识\n\n' +
      '## query 参数提取要点\n' +
      '  · pgroonga 做中文分词，给 2-6 个核心实词最佳；不要把整句原话当 query\n' +
      '  · 含指代时（"那只"），用上下文推断真正实词（如「比亚迪」）\n' +
      '  · 多个候选时优先最具识别度的（公司名 > 行业 > 通用词）\n\n' +
      '## time_range 使用\n' +
      '  · 用户说「3月份」→ time_start: "2026-03-01", time_end: "2026-03-31"\n' +
      '  · 用户说「5月10日当天」→ time_start: "2026-05-10", time_end: "2026-05-10"\n' +
      '  · 没明确时间不要传\n\n' +
      '## role_filter 使用\n' +
      '  · 用户问「我之前问过 X 吗」→ "user"（仅看用户当时的提问）\n' +
      '  · 用户问「你之前怎么说的」/「你给的清单是什么」→ "assistant"（仅看 agent 回答）\n' +
      '  · 不确定时不传（默认 all）\n\n' +
      '## 返回处理\n' +
      '  · 命中：按相关度+时间倒序的 message 列表，每条带 created_at（已转上海时间）+ role + 原文\n' +
      '  · 空召回：告诉模型「该用户没有相关历史」，正常回复即可\n' +
      '  · 自然引用即可（"你之前提到 X…"），不要描述检索过程',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词。2-6 个核心实词最佳。',
        },
        limit: {
          type: 'number',
          description: '返回条数（默认 10，上限 50）',
          default: 10,
          minimum: 1,
          maximum: 50,
        },
        days_back: {
          type: 'number',
          description:
            '时间窗口（天，简易模式）。不传则搜索全部历史。' +
            '更精确的时间用 time_start / time_end。',
        },
        time_start: {
          type: 'string',
          description:
            'ISO 时间戳（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ssZ），开始时间（含）。' +
            '用户提具体日期/月份时填。',
        },
        time_end: {
          type: 'string',
          description:
            'ISO 时间戳，结束时间（含）。与 time_start 配套使用。',
        },
        role_filter: {
          type: 'string',
          enum: ['user', 'assistant', 'all'],
          description:
            '角色筛选：' +
            'user = 仅用户当时的提问；' +
            'assistant = 仅 agent 当时的回答；' +
            'all = 不筛（默认）',
          default: 'all',
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
  time_start?: unknown;
  time_end?: unknown;
  role_filter?: unknown;
}

async function callSearchMemory(
  args: SearchMemoryArgs,
  userId: string,
  accessToken?: string
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new Error('参数 query 不能为空');
  }

  const limit =
    typeof args.limit === 'number' && args.limit > 0
      ? Math.floor(args.limit)
      : undefined;

  const daysBack =
    typeof args.days_back === 'number' && args.days_back > 0
      ? Math.floor(args.days_back)
      : null;

  const timeStart =
    typeof args.time_start === 'string' && args.time_start.length > 0
      ? args.time_start
      : null;
  const timeEnd =
    typeof args.time_end === 'string' && args.time_end.length > 0
      ? args.time_end
      : null;
  const rawRoleFilter =
    typeof args.role_filter === 'string'
      ? args.role_filter.toLowerCase().trim()
      : '';
  const roleFilter: 'user' | 'assistant' | 'all' | null =
    rawRoleFilter === 'user' || rawRoleFilter === 'assistant'
      ? rawRoleFilter
      : null;

  const provider = getMemoryProvider();
  const rows = await provider.search(
    query,
    { userId, accessToken },
    { limit, daysBack, timeStart, timeEnd, roleFilter }
  );

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
    const dt = formatShanghai(r.createdAt);
    const role = r.type === 'user' ? '用户' : 'Sage';
    const content = (r.content ?? '').slice(0, 500);
    lines.push(`---`);
    lines.push(
      `**[${dt}] ${role}** (task ${r.taskId.slice(0, 8)}, rank ${r.rank})`
    );
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
      err(
        null,
        ERR_INTERNAL,
        'Supabase not configured (need SUPABASE_URL + SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY)'
      ),
      200
    );
  }

  const userId = c.req.query('user_id');
  if (
    !userId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId
    )
  ) {
    return c.json(
      err(
        null,
        ERR_INVALID_PARAMS,
        'Missing or invalid ?user_id= query parameter (must be UUID)'
      ),
      200
    );
  }

  // access_token 可选：
  //   - 桌面端 sidecar 模式：buildBuiltinMcpServers 会带上前端透传的 JWT
  //   - Railway 模式：service role 已配置时不需要（provider 会 fallback）
  // 长度上限 4096 防止日志膨胀；JWT 一般 ~1KB
  const rawAccessToken = c.req.query('access_token');
  const accessToken =
    rawAccessToken && rawAccessToken.length > 0 && rawAccessToken.length <= 4096
      ? rawAccessToken
      : undefined;

  let body: JsonRpcRequest;
  try {
    body = (await c.req.json()) as JsonRpcRequest;
  } catch {
    return c.json(err(null, ERR_PARSE, 'Invalid JSON body'), 200);
  }

  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json(
      err(body.id, ERR_INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request'),
      200
    );
  }

  // ── Method dispatch ─────────────────────────────────────────────────────
  switch (body.method) {
    case 'initialize': {
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
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          })
        );
      }

      try {
        const result = await callSearchMemory(args, userId, accessToken);
        return c.json(ok(body.id, result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[mcp-memory] search_memory failed:`, msg);
        return c.json(
          ok(body.id, {
            isError: true,
            content: [
              { type: 'text', text: `search_memory error: ${msg}` },
            ],
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
        err(
          body.id,
          ERR_METHOD_NOT_FOUND,
          `Method not found: ${body.method}`
        )
      );
  }
});

mcpMemoryRoutes.get('/', (c) => {
  return c.text('MCP Memory server (POST JSON-RPC to this endpoint).', 200);
});
