/**
 * OpenAI-Compatible Chat Completions API
 *
 * Provides a /chat/completions endpoint that WeClaw and other
 * OpenAI-compatible clients can call to interact with Sage's Agent.
 *
 * Supports slash commands: /new, /reset, /compact
 * Integrates with the memory system for persistent user context.
 */

import { Hono } from 'hono';

import {
  createSession,
  runAgent,
  type AgentMessage,
  type ConversationMessage,
} from '@/shared/services/agent';
import { getProviderManager } from '@/shared/provider/manager';
import {
  appendOrCreateConversation,
  resetChannelSession,
} from '@/shared/services/channel-store';

/**
 * Read model config from provider manager (synced by desktop UI) or env vars.
 */
function getModelConfigFromProvider(): { apiKey?: string; baseUrl?: string; model?: string; apiType?: 'anthropic-messages' | 'openai-completions' } | undefined {
  try {
    const manager = getProviderManager();
    const agentCfg = manager.getConfig().agent?.config as Record<string, unknown> | undefined;

    const apiKey = (agentCfg?.apiKey as string)
      || process.env.ANTHROPIC_API_KEY
      || process.env.ANTHROPIC_AUTH_TOKEN
      || process.env.OPENAI_API_KEY;
    const baseUrl = (agentCfg?.baseUrl as string)
      || process.env.ANTHROPIC_BASE_URL
      || process.env.OPENAI_BASE_URL;
    const model = (agentCfg?.model as string)
      || process.env.AGENT_MODEL;
    const apiType = (agentCfg?.apiType as 'anthropic-messages' | 'openai-completions') || undefined;

    if (!apiKey) return undefined;
    return { apiKey, baseUrl, model, apiType };
  } catch {
    return undefined;
  }
}

const ARTIFACT_BLOCK_RE = /```artifact:[\w-]+\s*\n[\s\S]*?```/g;

function stripArtifacts(text: string): string {
  return text.replace(ARTIFACT_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

function buildCompletionResponse(content: string, model: string) {
  return {
    id: `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// ─── Slash command handlers ───────────────────────────────────────────────

interface SlashCommand {
  name: string;
  match: (text: string) => boolean;
}

const COMMANDS: SlashCommand[] = [
  { name: 'new', match: (t) => /^\/(new|新对话)\s*$/i.test(t.trim()) },
  { name: 'reset', match: (t) => /^\/(reset|重置)\s*$/i.test(t.trim()) },
  { name: 'compact', match: (t) => /^\/(compact|压缩)\s*$/i.test(t.trim()) },
  { name: 'help', match: (t) => /^\/(help|帮助|命令)\s*$/i.test(t.trim()) },
];

function detectCommand(text: string): string | null {
  for (const cmd of COMMANDS) {
    if (cmd.match(text)) return cmd.name;
  }
  return null;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompletionsRequestBody {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export const completionsRoutes = new Hono();

completionsRoutes.post('/chat/completions', async (c) => {
  const channelApiKey = process.env.HTCLAW_CHANNEL_API_KEY;
  if (channelApiKey) {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token !== channelApiKey) {
      return c.json(
        { error: { message: 'Invalid API key', type: 'invalid_request_error' } },
        401
      );
    }
  }

  let body: CompletionsRequestBody;
  try {
    body = await c.req.json<CompletionsRequestBody>();
  } catch {
    return c.json(
      { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } },
      400
    );
  }

  if (!body.messages || body.messages.length === 0) {
    return c.json(
      { error: { message: 'messages is required and must not be empty', type: 'invalid_request_error' } },
      400
    );
  }

  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    return c.json(
      { error: { message: 'No user message found', type: 'invalid_request_error' } },
      400
    );
  }

  const model = body.model || 'sage';

  // ─── Slash command handling ─────────────────────────────────────────
  const command = detectCommand(lastUserMsg.content);

  if (command === 'new') {
    resetChannelSession('wechat');
    return c.json(buildCompletionResponse(
      '✅ 已开启新对话。之前的上下文已清除，请开始新的提问。',
      model,
    ));
  }

  if (command === 'reset') {
    resetChannelSession('wechat');
    return c.json(buildCompletionResponse(
      '✅ 已重置会话。当前对话上下文已清除。\n\n云端历史记忆不受影响，需要时我会主动调取。',
      model,
    ));
  }

  if (command === 'help') {
    const helpText = [
      '📋 可用命令：',
      '',
      '/new — 开启新对话，清除当前上下文',
      '/reset — 重置会话（清除上下文+短期记忆）',
      '/compact — 压缩对话上下文，减少 token 消耗',
      '/help — 显示此帮助信息',
      '',
      '💡 直接发送消息即可正常对话。',
    ].join('\n');
    return c.json(buildCompletionResponse(helpText, model));
  }

  if (command === 'compact') {
    const { compactMessages, estimateTokens } = await import('@/shared/context/compaction');
    const sessionMessages = body.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date().toISOString(),
        tokenEstimate: estimateTokens(m.content),
      }));

    if (sessionMessages.length < 3) {
      return c.json(buildCompletionResponse('当前对话太短，无需压缩。', model));
    }

    try {
      const summary = await compactMessages(sessionMessages);
      if (summary) {
        const reply = `✅ 上下文已压缩（${sessionMessages.length} 条消息 → ${summary.tokenEstimate} tokens）。\n\n${summary.summary}\n\n请基于此摘要继续对话。`;
        return c.json(buildCompletionResponse(reply, model));
      }
      return c.json(buildCompletionResponse('压缩失败，消息太少。', model));
    } catch {
      return c.json(buildCompletionResponse('压缩失败，请稍后重试。', model));
    }
  }

  // ─── Normal message flow ────────────────────────────────────────────

  const history: ConversationMessage[] = [];
  for (const msg of body.messages) {
    if (msg === lastUserMsg) break;
    if (msg.role === 'user' || msg.role === 'assistant') {
      history.push({ role: msg.role, content: msg.content });
    }
  }

  const session = createSession('execute');
  const modelConfig = getModelConfigFromProvider();

  console.log('[Completions] Request:', {
    model,
    prompt: lastUserMsg.content.slice(0, 80),
    historyLength: history.length,
    hasModelConfig: !!modelConfig,
  });

  try {
    const agentMessages: AgentMessage[] = [];

    for await (const msg of runAgent(
      lastUserMsg.content,
      session,
      history.length > 0 ? history : undefined,
      undefined,
      undefined,
      modelConfig,
    )) {
      agentMessages.push(msg);
    }

    // Collect text from content-bearing message types
    // 'result' is SDK metadata (subtype like "end_turn"/"error"), not user-facing content
    const CONTENT_TYPES = new Set(['text', 'direct_answer']);
    const textParts = agentMessages
      .filter((m): m is AgentMessage & { content: string } =>
        CONTENT_TYPES.has(m.type) && !!m.content
      )
      .map((m) => m.content);

    // If no content, check for error messages
    if (textParts.length === 0) {
      const errorMsgs = agentMessages.filter((m) => m.type === 'error' && (m as any).message);
      const resultErrorMsgs = agentMessages.filter((m) => m.type === 'result' && (m as any).content === 'error');

      if (errorMsgs.length > 0) {
        const errMsg = (errorMsgs[0] as any).message as string;
        if (errMsg.includes('__API_KEY_ERROR__')) {
          textParts.push('⚠️ AI 模型未配置或 API Key 无效，请在设置中检查模型配置。');
        } else {
          textParts.push('⚠️ 处理消息时出现错误，请稍后重试。');
        }
      } else if (resultErrorMsgs.length > 0) {
        textParts.push('⚠️ AI 模型调用失败，可能是 API 格式不兼容，请在设置中检查模型的 API 类型配置。');
      }
    }

    const rawText = textParts.join('\n');
    const cleanText = stripArtifacts(rawText) || '处理完成';

    appendOrCreateConversation('wechat', lastUserMsg.content, cleanText);

    return c.json(buildCompletionResponse(cleanText, model));
  } catch (error) {
    console.error('[Completions] Agent error:', error);
    return c.json(
      { error: { message: 'Agent execution failed', type: 'server_error' } },
      500
    );
  }
});

completionsRoutes.get('/models', (c) => {
  return c.json({
    object: 'list',
    data: [
      {
        id: 'sage',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'sage',
      },
    ],
  });
});
