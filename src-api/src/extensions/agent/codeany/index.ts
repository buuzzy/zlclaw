/**
 * CodeAny Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @codeany/open-agent-sdk.
 * Runs entirely in-process — no external CLI binary required.
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';
import {
  query,
} from '@codeany/open-agent-sdk';
import type { AgentOptions as SdkAgentOptions } from '@codeany/open-agent-sdk';

import { refreshSkillsForPrompt } from '@/shared/skills/predictor';

import {
  BaseAgent,
  buildLanguageInstruction,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import { CODEANY_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  ImageAttachment,
  McpConfig,
  PlanOptions,
  SkillsConfig,
} from '@/core/agent/types';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';
import { getSageSystemPrompt } from '@/config/prompt-loader';
import { appendDailyMemory } from '@/shared/memory/daily-writer';
import { loadMcpServers, type McpServerConfig } from '@/shared/mcp/loader';
import { createLogger, LOG_FILE_PATH } from '@/shared/utils/logger';
import { stripHashSuffix } from '@/shared/utils/url';

const logger = createLogger('CodeAnyAgent');

// Sandbox API URL
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

// ============================================================================
// Helper functions
// ============================================================================

function expandPath(inputPath: string): string {
  let result = inputPath;
  if (result.startsWith('~')) {
    result = join(homedir(), result.slice(1));
  }
  if (platform() === 'win32') {
    result = result.replace(/\//g, '\\');
  }
  return result;
}

function generateFallbackSlug(prompt: string, taskId: string): string {
  let slug = prompt
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');

  if (!slug || slug.length < 3) {
    slug = 'task';
  }

  const suffix = taskId.slice(-6);
  return `${slug}-${suffix}`;
}

function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): string {
  const expandedPath = expandPath(workDir);

  const hasSessionsPath = expandedPath.includes('/sessions/') || expandedPath.includes('\\sessions\\');
  const endsWithSessions = expandedPath.endsWith('/sessions') || expandedPath.endsWith('\\sessions');
  if (hasSessionsPath && !endsWithSessions) {
    return expandedPath;
  }

  const baseDir = expandedPath;
  const sessionsDir = join(baseDir, 'sessions');

  let folderName: string;
  if (prompt && taskId) {
    folderName = generateFallbackSlug(prompt, taskId);
  } else if (taskId) {
    folderName = taskId;
  } else {
    folderName = `session-${Date.now()}`;
  }

  return join(sessionsDir, folderName);
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string
): Promise<string[]> {
  const savedPaths: string[] = [];
  if (images.length === 0) return savedPaths;

  await ensureDir(workDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.mimeType.split('/')[1] || 'png';
    const filename = `image_${Date.now()}_${i}.${ext}`;
    const filePath = join(workDir, filename);

    try {
      let base64Data = image.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      logger.info(`[CodeAny] Saved image to: ${filePath}`);
    } catch (error) {
      logger.error(`[CodeAny] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

// ============================================================================
// Default tools
// ============================================================================

const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'Task',
  'LSP',
  'TodoWrite',
  'Agent',       // 多 Agent 并行协作（AgentTool）
  'SendMessage', // 跨 Agent 消息传递
];

// ============================================================================
// CodeAny Agent class
// ============================================================================

export class CodeAnyAgent extends BaseAgent {
  readonly provider: AgentProvider = 'codeany';

  constructor(config: AgentConfig) {
    super(config);
    logger.info('[CodeAnyAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  private looksLikeError(output: string): boolean {
    if (!output || output.length < 10) return false;
    const lower = output.toLowerCase();
    const errorPatterns = [
      'error:', 'exception:', 'traceback', 'econnrefused',
      'etimedout', 'enotfound', 'status_code', 'failed to',
      'permission denied', '401', '403', '500', '502', '503',
    ];
    return errorPatterns.some(p => lower.includes(p)) && output.length < 500;
  }

  private buildSdkOptions(
    sessionCwd: string,
    options?: AgentOptions,
    extraOpts?: Partial<SdkAgentOptions>,
    systemPrompt?: string
  ): SdkAgentOptions {
    const sdkOpts: SdkAgentOptions = {
      cwd: sessionCwd,
      model: this.config.model,
      permissionMode: 'bypassPermissions',
      maxTurns: 200,
      thinking: { type: 'adaptive' },
      ...extraOpts,
    };

    // Set API type
    if (this.config.apiType) {
      (sdkOpts as any).apiType = this.config.apiType;
    }

    // Set API credentials
    if (this.config.apiKey) {
      sdkOpts.apiKey = this.config.apiKey;
    }
    if (this.config.baseUrl) {
      sdkOpts.baseURL = stripHashSuffix(this.config.baseUrl);
    }

    // Inject SOUL.md + AGENTS.md + memory as a proper system prompt field.
    // For OpenAI-compatible APIs (e.g. MiniMax) the SDK passes this as the
    // system message, ensuring the model treats it as instructions rather than
    // user input.  appendSystemPrompt appends after the SDK's built-in prompt.
    if (systemPrompt) {
      sdkOpts.appendSystemPrompt = systemPrompt;
    }

    // Set allowed tools
    sdkOpts.allowedTools = options?.allowedTools || ALLOWED_TOOLS;

    // Set abort controller
    if (options?.abortController) {
      sdkOpts.abortController = options.abortController;
    }

    return sdkOpts;
  }

  /**
   * Build conversation context using the Context Assembler.
   * Supports disk-persisted sessions and automatic compaction.
   */
  private async buildConversationContext(
    sessionId: string,
    conversation?: ConversationMessage[]
  ): Promise<string> {
    if (!conversation || conversation.length === 0) return '';

    try {
      const { assembleContext } = await import('@/shared/context/assembler');
      const maxContextTokens = (this.config.providerConfig?.maxHistoryTokens as number) || 12000;

      const result = await assembleContext(sessionId, conversation, {
        maxContextTokens,
      });

      if (result.compacted) {
        logger.info(`[CodeAny ${sessionId}] Context compacted: ${result.estimatedTokens} tokens, ${result.recentMessageCount} recent messages kept`);
      }

      return result.context;
    } catch (err) {
      logger.warn(`[CodeAny ${sessionId}] Context assembly failed, falling back:`, err);
      return this.formatConversationHistoryFallback(conversation);
    }
  }

  /**
   * Fallback: simple truncation (used when assembler fails).
   */
  private formatConversationHistoryFallback(conversation: ConversationMessage[]): string {
    const maxTokens = (this.config.providerConfig?.maxHistoryTokens as number) || 12000;
    const parts: string[] = [];
    let budget = maxTokens;

    for (let i = conversation.length - 1; i >= 0 && budget > 0; i--) {
      const msg = conversation[i];
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const line = `${role}: ${msg.content}`;
      const tokens = Math.ceil(line.length / 4);
      if (budget - tokens < 0 && parts.length >= 2) break;
      parts.unshift(line);
      budget -= tokens;
    }

    if (parts.length === 0) return '';
    return `## Previous Conversation Context\n\n${parts.join('\n\n')}\n\n---\n## Current Request\n`;
  }

  private sanitizeText(text: string): string {
    let sanitized = text;

    // Strip reasoning tags emitted by MiniMax and other thinking models
    // (e.g. <think>...</think>) — they should never be shown to the user.
    sanitized = sanitized.replace(/<think>[\s\S]*?<\/think>\s*/g, '');

    const apiKeyErrorPatterns = [
      /Invalid API key/i, /invalid_api_key/i, /API key.*invalid/i,
      /authentication.*fail/i, /Unauthorized/i,
      /身份验证失败/, /认证失败/, /鉴权失败/, /密钥无效/,
    ];

    if (apiKeyErrorPatterns.some((p) => p.test(sanitized))) {
      return '__API_KEY_ERROR__';
    }

    return sanitized;
  }

  private *processMessage(
    message: unknown,
    sessionId: string,
    sentTextHashes: Set<string>,
    sentToolIds: Set<string>
  ): Generator<AgentMessage> {
    const msg = message as {
      type: string;
      message?: { content?: unknown[] };
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      result?: { tool_use_id?: string; tool_name?: string; output?: string };
    };

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('text' in block) {
          const sanitizedText = this.sanitizeText(block.text as string);
          const textHash = sanitizedText.slice(0, 100);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            yield { type: 'text', content: sanitizedText };
          }
        } else if ('name' in block && 'id' in block) {
          const toolId = block.id as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            yield { type: 'tool_use', id: toolId, name: block.name as string, input: block.input };
          }
        }
      }
    }

    if (msg.type === 'tool_result' && msg.result) {
      const output = msg.result.output ?? '';
      const isError = !!(msg.result as any).is_error || this.looksLikeError(output);
      yield {
        type: 'tool_result',
        toolUseId: msg.result.tool_use_id ?? '',
        output,
        isError,
      };
    }

    if (msg.type === 'result') {
      yield {
        type: 'result', content: msg.subtype,
        cost: msg.total_cost_usd, duration: msg.duration_ms,
      };
    }
  }

  // ==========================================================================
  // Core agent methods
  // ==========================================================================

  async *run(prompt: string, options?: AgentOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir, prompt, options?.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[CodeAny ${session.id}] Working Directory: ${sessionCwd}`);

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();
    // Accumulates assistant reply text for daily memory write
    const assistantTextParts: string[] = [];

    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    // Save images to disk so they can be referenced in the text prompt
    // (The SDK's query() accepts string only; multimodal arrays are not supported)
    let imagePaths: string[] = [];
    if (options?.images && options.images.length > 0) {
      imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      if (imagePaths.length > 0) {
        logger.info(`[CodeAny] Saved ${imagePaths.length} image(s) to disk`);
      }
    }

    // Use taskId as persistent context key (stable across turns); fall back to session.id
    const contextSessionId = options?.taskId || session.id;
    const conversationContext = await this.buildConversationContext(contextSessionId, options?.conversation);
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);
    const sageSystemPrompt = await getSageSystemPrompt(prompt);

    // System prompt (SOUL.md + AGENTS.md + memory) is injected via SDK's
    // appendSystemPrompt so OpenAI-compatible APIs treat it as a system message.
    // Only workspace/conversation/language context remains in the text prompt.
    const textPrompt = getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext + languageInstruction + prompt;

    // Build the final prompt: always a string (images referenced by file path)
    let finalPrompt: string;
    if (imagePaths.length > 0) {
      finalPrompt = textPrompt + `\n\n[Attached image file(s) saved to disk: ${imagePaths.join(', ')}]`;
      logger.info(`[CodeAny] Using text prompt with ${imagePaths.length} image path(s) appended`);
    } else {
      finalPrompt = textPrompt;
    }

    // Load MCP servers
    const userMcpServers = await loadMcpServers(options?.mcpConfig as McpConfig | undefined);

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      abortController: options?.abortController || session.abortController,
    }, sageSystemPrompt);

    // Add MCP servers if any
    if (Object.keys(userMcpServers).length > 0) {
      sdkOpts.mcpServers = userMcpServers;
      logger.info(`[CodeAny ${session.id}] MCP servers: ${Object.keys(userMcpServers).join(', ')}`);
    }

    logger.info(`[CodeAny ${session.id}] ========== AGENT START ==========`);
    logger.info(`[CodeAny ${session.id}] Model: ${this.config.model || '(default)'}`);
    logger.info(`[CodeAny ${session.id}] Custom API: ${this.isUsingCustomApi()}`);
    logger.info(`[CodeAny ${session.id}] Prompt length: ${finalPrompt.length} chars`);
    logger.info(`[CodeAny ${session.id}] Images (disk): ${imagePaths.length > 0 ? `yes (${imagePaths.length} files)` : 'no'}`);

    // Dynamically swap in only the skills relevant to this prompt
    // so the model context stays lean each turn.
    await refreshSkillsForPrompt(prompt);

    try {
      for await (const message of query({ prompt: finalPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;
        for (const msg of this.processMessage(message, session.id, sentTextHashes, sentToolIds)) {
          if (msg.type === 'text' && (msg as any).content) {
            assistantTextParts.push((msg as any).content);
          }
          yield msg;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CodeAny ${session.id}] Error:`, { message: errorMessage });

      const noApiKeyConfigured = !this.config.apiKey;
      const usingCustomApi = this.isUsingCustomApi();

      const isApiKeyError =
        errorMessage.includes('Invalid API key') || errorMessage.includes('invalid_api_key') ||
        errorMessage.includes('API key') || errorMessage.includes('authentication') ||
        errorMessage.includes('Unauthorized') || errorMessage.includes('401') ||
        errorMessage.includes('403') || noApiKeyConfigured;

      const isApiCompatibilityError = usingCustomApi && (
        errorMessage.includes('model') || errorMessage.includes('not found')
      );

      if (isApiKeyError) {
        yield { type: 'error', message: '__API_KEY_ERROR__' };
      } else if (isApiCompatibilityError) {
        yield { type: 'error', message: `__CUSTOM_API_ERROR__|${this.config.baseUrl}|${LOG_FILE_PATH}` };
      } else {
        yield { type: 'error', message: `__INTERNAL_ERROR__|${LOG_FILE_PATH}` };
      }
    } finally {
      // Persist this turn to daily memory (fire-and-forget)
      const assistantReply = assistantTextParts.join('\n').trim();
      if (assistantReply) {
        appendDailyMemory(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), assistantReply);
      }

      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *plan(prompt: string, options?: PlanOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir, prompt, options?.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[CodeAny ${session.id}] Planning started, cwd: ${sessionCwd}`);

    const workspaceInstruction = `\n## CRITICAL: Output Directory\n**ALL files must be saved to: ${sessionCwd}**\n`;
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);
    const sageSystemPrompt = await getSageSystemPrompt(prompt);
    const planningPrompt = workspaceInstruction + PLANNING_INSTRUCTION + languageInstruction + prompt;

    let fullResponse = '';

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      allowedTools: [],
      abortController: options?.abortController || session.abortController,
    }, sageSystemPrompt);

    try {
      for await (const message of query({ prompt: planningPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;

        if ((message as any).type === 'assistant' && (message as any).message?.content) {
          for (const block of (message as any).message.content) {
            if ('text' in block) {
              // planning phase 必须和 run() 一样走 sanitizeText，
              // 否则 MiniMax 等 thinking 模型的 <think>...</think> 原文会直接
              // 漏到 UI / transcript 里（已见于线上 minimax 反馈日志）。
              const sanitizedText = this.sanitizeText(block.text);
              fullResponse += block.text; // fullResponse 给 parser 用原文
              if (sanitizedText) {
                yield { type: 'text', content: sanitizedText };
              }
            }
          }
        }
      }

      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === 'direct_answer') {
        yield { type: 'direct_answer', content: planningResult.answer };
      } else if (planningResult?.type === 'plan' && planningResult.plan.steps.length > 0) {
        this.storePlan(planningResult.plan);
        yield { type: 'plan', plan: planningResult.plan };
      } else {
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          yield { type: 'plan', plan };
        } else {
          // Fallback: 当 parser 识别不出任何结构化产物时，
          // 上面的循环已经把 block.text 作为 text 消息流式 yield 给 UI 了，
          // 这里如果再把 fullResponse 打包成 direct_answer，UI 会把同样内容
          // 再追加一次（direct_answer 被渲染为 text）— 造成 transcript 里的
          // "block 4 = block 1+2+3 合并" 重复问题（见 minimax 反馈日志）。
          // 仅 yield done，让已经流式输出的 text 自己闭合。
          logger.warn(
            `[CodeAny ${session.id}] Planning produced unstructured response; ` +
            `streamed as text already, skipping duplicate direct_answer fallback.`
          );
        }
      }
    } catch (error) {
      logger.error(`[CodeAny ${session.id}] Planning error:`, error);
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      // Persist planning turn to daily memory (fire-and-forget)
      if (fullResponse.trim()) {
        appendDailyMemory(prompt, fullResponse.trim());
      }
      yield { type: 'done' };
    }
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options.sessionId,
      abortController: options.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir, options.originalPrompt, options.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[CodeAny ${session.id}] Executing plan: ${plan.id}, cwd: ${sessionCwd}`);

    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    const sageSystemPrompt = await getSageSystemPrompt(options.originalPrompt);
    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts, options.language, options.originalPrompt) +
      '\n\nOriginal request: ' + options.originalPrompt;

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();
    // Accumulates assistant reply text for daily memory write
    const assistantTextParts: string[] = [];

    const userMcpServers = await loadMcpServers(options.mcpConfig as McpConfig | undefined);

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      abortController: options.abortController || session.abortController,
    }, sageSystemPrompt);

    if (Object.keys(userMcpServers).length > 0) {
      sdkOpts.mcpServers = userMcpServers;
    }

    // Dynamically swap in only the skills relevant to this plan's original prompt
    if (options.originalPrompt) {
      await refreshSkillsForPrompt(options.originalPrompt);
    }

    try {
      for await (const message of query({ prompt: executionPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;
        for (const msg of this.processMessage(message, session.id, sentTextHashes, sentToolIds)) {
          if (msg.type === 'text' && (msg as any).content) {
            assistantTextParts.push((msg as any).content);
          }
          yield msg;
        }
      }
    } catch (error) {
      logger.error(`[CodeAny ${session.id}] Execution error:`, error);
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      // Persist execution turn to daily memory (fire-and-forget)
      const assistantReply = assistantTextParts.join('\n').trim();
      if (assistantReply && options.originalPrompt) {
        appendDailyMemory(options.originalPrompt, assistantReply);
      }

      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }
}

// ============================================================================
// Factory & Plugin
// ============================================================================

export function createCodeAnyAgent(config: AgentConfig): CodeAnyAgent {
  return new CodeAnyAgent(config);
}

export const codeanyPlugin: AgentPlugin = defineAgentPlugin({
  metadata: CODEANY_METADATA,
  factory: (config) => createCodeAnyAgent(config),
});
