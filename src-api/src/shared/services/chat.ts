/**
 * Lightweight Chat Service
 *
 * Directly calls the LLM API for simple conversational queries,
 * bypassing the Claude Agent SDK to avoid CLI subprocess, tools, and thinking mode overhead.
 *
 * Supports both Anthropic (native SDK) and OpenAI-compatible APIs (fetch).
 */

import Anthropic from '@anthropic-ai/sdk';

import type { AgentMessage, ConversationMessage } from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';
import { buildEndpointUrl, stripHashSuffix } from '@/shared/utils/url';

const logger = createLogger('ChatService');

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// Maximum number of conversation messages to include in API calls
// to prevent excessive token usage. Each "turn" is a user+assistant pair.
const MAX_CONTEXT_MESSAGES = 40; // 20 turns × 2 messages

function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-') || model.includes('claude');
}

/**
 * Determine if the Anthropic SDK should be used for this request.
 * True when: explicit apiType is 'anthropic-messages', OR model name contains 'claude'.
 */
function shouldUseAnthropicSDK(model: string, apiType?: string): boolean {
  if (apiType === 'anthropic-messages') return true;
  return isAnthropicModel(model);
}

function resolveConfig(modelConfig?: { apiKey?: string; baseUrl?: string; model?: string }) {
  // Use explicit modelConfig from user settings only — no environment variable fallback
  const apiKey = modelConfig?.apiKey || '';
  const baseURL = modelConfig?.baseUrl || undefined;
  const model = modelConfig?.model || DEFAULT_MODEL;

  return { apiKey, baseURL, model };
}

function buildSystemPrompt(base: string, language?: string): string {
  let systemPrompt = base;
  if (language) {
    const langMap: Record<string, string> = {
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      'en-US': 'English',
      'ja-JP': 'Japanese',
      'ko-KR': 'Korean',
    };
    const langName = langMap[language] || language;
    systemPrompt += ` Please respond in ${langName}.`;
  }
  return systemPrompt;
}

// ============================================================================
// OpenAI-compatible streaming (for non-Anthropic models via proxy)
// ============================================================================

async function* runOpenAICompatibleChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  abortController?: AbortController
): AsyncGenerator<AgentMessage> {
  // Derive the OpenAI-compatible base URL from the Anthropic-style baseURL
  // e.g. "https://openrouter.ai/api/v1" -> use as-is, append /chat/completions
  // Most proxies support /v1/chat/completions
  let endpoint: string;
  if (baseURL) {
    endpoint = buildEndpointUrl(baseURL, '/chat/completions');
  } else {
    endpoint = 'https://api.openai.com/v1/chat/completions';
  }

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  logger.info('[ChatService] OpenAI-compatible request:', { endpoint, model });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      max_tokens: 4096,
      stream: true,
    }),
    signal: abortController?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield { type: 'text', content };
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  yield { type: 'done' };
}

/**
 * Strip `<think>...</think>` blocks (DeepSeek-R1 / MiniMax thinking / o1 等推理模型
 * 会把内部推理混在普通 content 里返回)。
 *
 * 匹配所有形态：
 *   - `<think>...</think>` 完整成对
 *   - `<think>...` 后面没闭合（超时截断 / 被 max_tokens 截断）
 *   - 多段重复
 *
 * 主要服务 generateTitle()：标题请求只允许返回干净文本，否则 `<think>` 内容
 * 会直接被存成 task.prompt，污染 session 标题、UI 气泡和 cloud preview。
 */
function stripThinking(text: string): string {
  if (!text) return text;
  // 先去成对的 <think>...</think>
  let out = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  // 再去残留的开头或结尾半截标签（被截断的情况）
  out = out.replace(/<think\b[^>]*>[\s\S]*$/i, '');
  out = out.replace(/^[\s\S]*<\/think>/i, '');
  return out.trim();
}

async function openAICompatibleCreate(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  maxTokens: number
): Promise<string> {
  let endpoint: string;
  if (baseURL) {
    endpoint = buildEndpointUrl(baseURL, '/chat/completions');
  } else {
    endpoint = 'https://api.openai.com/v1/chat/completions';
  }

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================================================
// Main chat function
// ============================================================================

/**
 * Run a lightweight chat using the appropriate API.
 * - Anthropic models: uses Anthropic SDK
 * - Other models: uses OpenAI-compatible fetch
 */
export async function* runChat(
  prompt: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string; apiType?: string },
  language?: string,
  conversation?: ConversationMessage[],
  abortController?: AbortController
): AsyncGenerator<AgentMessage> {
  const { apiKey, baseURL, model } = resolveConfig(modelConfig);
  const apiType = modelConfig?.apiType;

  if (!apiKey) {
    yield { type: 'error', message: 'No API key configured. Please set up your API key in Settings.' };
    yield { type: 'done' };
    return;
  }

  logger.info('[ChatService] Starting chat:', {
    model,
    hasBaseURL: !!baseURL,
    isAnthropic: shouldUseAnthropicSDK(model, apiType),
    hasConversation: !!(conversation && conversation.length > 0),
    promptLength: prompt.length,
  });

  const systemPrompt = buildSystemPrompt(
    'You are a helpful assistant. Be concise and direct in your responses. ' +
    'You have network access capabilities. When users ask about URLs, websites, or online content, ' +
    'you should attempt to help by analyzing the URL structure, inferring content from the domain/path, ' +
    'or suggesting the user switch to Agent/Task mode for full web access with tools like curl and browser automation.',
    language
  );

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (conversation && conversation.length > 0) {
    // Limit conversation history to prevent excessive token usage
    const trimmedConversation = conversation.length > MAX_CONTEXT_MESSAGES
      ? conversation.slice(-MAX_CONTEXT_MESSAGES)
      : conversation;

    if (trimmedConversation.length < conversation.length) {
      logger.info(`[ChatService] Truncated conversation history from ${conversation.length} to ${trimmedConversation.length} messages`);
    }

    for (const msg of trimmedConversation) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: prompt });

  // Non-Anthropic protocol: use OpenAI-compatible API
  if (!shouldUseAnthropicSDK(model, apiType)) {
    try {
      yield* runOpenAICompatibleChat(messages, systemPrompt, apiKey, baseURL, model, abortController);
    } catch (error) {
      if (abortController?.signal.aborted) {
        logger.info('[ChatService] Chat aborted by user');
        yield { type: 'done' };
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[ChatService] OpenAI-compatible chat error:', errorMessage);
      yield { type: 'error', message: errorMessage };
      yield { type: 'done' };
    }
    return;
  }

  // Anthropic models: use Anthropic SDK
  const client = new Anthropic({ apiKey, baseURL: baseURL ? stripHashSuffix(baseURL) : undefined });

  try {
    const requestParams: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    };

    requestParams.thinking = { type: 'disabled' };

    const stream = client.messages.stream(
      requestParams as Parameters<typeof client.messages.stream>[0]
    );

    if (abortController) {
      abortController.signal.addEventListener('abort', () => {
        stream.abort();
      });
    }

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'text', content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    logger.info('[ChatService] Chat completed:', {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });

    yield { type: 'done' };
  } catch (error) {
    if (abortController?.signal.aborted) {
      logger.info('[ChatService] Chat aborted by user');
      yield { type: 'done' };
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[ChatService] Chat error:', errorMessage);
    yield { type: 'error', message: errorMessage };
    yield { type: 'done' };
  }
}

// ============================================================================
// Title generation
// ============================================================================

/**
 * Generate a short title from a user prompt.
 * Uses a lightweight LLM call to summarize the prompt into a concise title.
 */
export async function generateTitle(
  prompt: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string; apiType?: string },
  language?: string
): Promise<string> {
  const { apiKey, baseURL, model } = resolveConfig(modelConfig);

  if (!apiKey) {
    return prompt.slice(0, 30) + (prompt.length > 30 ? '...' : '');
  }

  const langHint = language?.startsWith('zh') ? '请用中文回复。' : '';
  const systemPrompt = `Generate a very short title (max 20 characters) that summarizes the user's request. Output ONLY the title, no quotes, no punctuation at the end, no explanation. ${langHint}`;

  try {
    let title: string;

    if (!shouldUseAnthropicSDK(model, modelConfig?.apiType)) {
      // Non-Anthropic protocol: OpenAI-compatible
      title = await openAICompatibleCreate(
        [{ role: 'user', content: prompt }],
        systemPrompt,
        apiKey,
        baseURL,
        model,
        50
      );
    } else {
      // Anthropic: native SDK
      const client = new Anthropic({ apiKey, baseURL: baseURL ? stripHashSuffix(baseURL) : undefined });
      const requestParams: Record<string, unknown> = {
        model,
        max_tokens: 50,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
      };

      const response = await (client.messages.create as Function)(requestParams);
      title = (response.content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === 'text')
        .map((block) => block.text || '')
        .join('')
        .trim();
    }

    logger.info('[ChatService] Generated title (raw):', { prompt: prompt.slice(0, 50), title });

    // 去掉 <think>...</think>（thinking 模型会把推理混进 content）
    let cleaned = stripThinking(title);

    // 模型可能返回多行、前后空白、或"标题: xxx"这种引导；取首行并截断长度
    cleaned = cleaned.split(/\r?\n/)[0].trim();
    // 去头尾引号
    cleaned = cleaned.replace(/^["'「『]+|["'」』]+$/g, '').trim();
    // 长度保底：超过 40 字符就被视为异常输出，回退到 prompt 截断
    if (cleaned.length === 0 || cleaned.length > 40) {
      logger.warn('[ChatService] title sanitize rejected output:', {
        rawLen: title.length,
        cleanedLen: cleaned.length,
      });
      return prompt.slice(0, 30) + (prompt.length > 30 ? '...' : '');
    }

    return cleaned;
  } catch (error) {
    logger.error('[ChatService] Title generation failed:', error);
    return prompt.slice(0, 30) + (prompt.length > 30 ? '...' : '');
  }
}
