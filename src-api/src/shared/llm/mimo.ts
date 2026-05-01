/**
 * Xiaomi MiMo API Client
 *
 * MiMo 是 OpenAI 兼容的 API（POST /v1/chat/completions, Authorization: Bearer）。
 * 我们不引入 openai SDK 是为了：
 *   · 减少 sage-api 二进制体积（pkg 打包对包数量敏感）
 *   · 蒸馏 cron 只需要 chat/completions 这一条接口，原生 fetch 已足够
 *   · 错误信息直接拿原始 response 更利于排障
 *
 * 环境变量：
 *   · MIMO_API_KEY (必填)
 *   · MIMO_BASE_URL (可选)
 *       - 官方 API:  https://api.xiaomimimo.com/v1 (默认)
 *       - Coding Plan: https://token-plan-sgp.xiaomimimo.com/v1
 *
 * 常见模型：
 *   · 官方 API: mimo-v2-flash / mimo-v2-pro / mimo-v2-omni
 *   · Coding Plan: MiMo-V2.5-Pro / MiMo-V2.5 / MiMo-V2-Pro / MiMo-V2-Omni
 *
 * 参考：https://platform.xiaomimimo.com/docs/zh-CN/quick-start/first-api-call
 */

const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';

function getBaseUrl(): string {
  const url = process.env.MIMO_BASE_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, '') : DEFAULT_MIMO_BASE_URL;
}

/**
 * 模型名设计为开放字符串：不同套餐 / 协议入口提供不同模型集，强约束 union 反而限制可扩展性。
 * 调用方负责传入对应入口可用的型号。
 */
export type MimoModel = string;

export interface MimoMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MimoChatOptions {
  model: MimoModel;
  messages: MimoMessage[];
  /** 强制 JSON 输出 */
  response_format?: { type: 'json_object' | 'text' };
  temperature?: number;
  max_tokens?: number;
  /** 整体超时（ms），默认 60s */
  timeoutMs?: number;
}

export interface MimoChatResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class MimoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'MimoApiError';
  }
}

/**
 * 调 MiMo chat completions。
 * 失败抛 MimoApiError（含 HTTP status 和原始 body 便于上层日志）。
 */
export async function mimoChat(
  options: MimoChatOptions
): Promise<MimoChatResponse> {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    throw new MimoApiError('MIMO_API_KEY environment variable is missing', 0);
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        ...(options.response_format && { response_format: options.response_format }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.max_tokens && { max_tokens: options.max_tokens }),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new MimoApiError(
        `MiMo API HTTP ${res.status} ${res.statusText}`,
        res.status,
        body
      );
    }

    const json = (await res.json()) as MimoChatResponse;
    return json;
  } catch (e) {
    if (e instanceof MimoApiError) throw e;
    if ((e as { name?: string }).name === 'AbortError') {
      throw new MimoApiError(`MiMo API timeout after ${timeoutMs}ms`, 0);
    }
    throw new MimoApiError(
      e instanceof Error ? e.message : String(e),
      0
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 提取 chat completion 的 assistant content。
 * 没有 choices 或 content 为空则抛错。
 */
export function extractContent(res: MimoChatResponse): string {
  const content = res.choices?.[0]?.message?.content;
  if (!content) {
    throw new MimoApiError(
      'MiMo response missing choices[0].message.content',
      0,
      JSON.stringify(res).slice(0, 500)
    );
  }
  return content;
}

/**
 * 强制 JSON 模式调用 + 解析。
 * 失败时抛错（含原始返回内容便于排障）。
 */
export async function mimoChatJson<T = unknown>(
  options: Omit<MimoChatOptions, 'response_format'>
): Promise<T> {
  const res = await mimoChat({
    ...options,
    response_format: { type: 'json_object' },
  });
  const content = extractContent(res);
  try {
    return JSON.parse(content) as T;
  } catch (e) {
    throw new MimoApiError(
      `Failed to parse MiMo JSON response: ${e instanceof Error ? e.message : String(e)}`,
      0,
      content.slice(0, 1000)
    );
  }
}
