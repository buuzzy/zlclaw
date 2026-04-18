/**
 * Slash Commands — shared between Channel layer and Agent API.
 *
 * Provides unified slash command matching and execution so that
 * /new, /reset, /status, /compact, /help work identically in
 * both desktop app and IM channels (Feishu, WeChat, etc.).
 */

interface SlashCommandMatch {
  name: string;
}

const SLASH_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'new',     pattern: /^\/(new|新对话)\s*$/i },
  { name: 'reset',   pattern: /^\/(reset|重置)\s*$/i },
  { name: 'status',  pattern: /^\/(status|状态)\s*$/i },
  { name: 'compact', pattern: /^\/(compact|压缩)\s*$/i },
  { name: 'help',    pattern: /^\/(help|帮助|命令)\s*$/i },
];

/**
 * Match a user message against known slash commands.
 * Returns the command name if matched, null otherwise.
 */
export function matchSlashCommand(text: string): SlashCommandMatch | null {
  const trimmed = text.trim();
  for (const { name, pattern } of SLASH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { name };
    }
  }
  return null;
}

/**
 * Execute a slash command and return the response text.
 * This is the "pure logic" layer — no adapter/channel dependency.
 * Channel-specific actions (like clearing channel session) are handled
 * by the caller after getting the response.
 */
/** Known context window sizes by model name pattern */
const CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/opus.*1m|1m.*opus/i, 1000000],
  [/opus/i, 200000],
  [/sonnet/i, 200000],
  [/haiku/i, 200000],
  [/gpt-4o/i, 128000],
  [/gpt-4-turbo/i, 128000],
  [/gpt-4$/i, 8192],
  [/gpt-3/i, 16384],
  [/deepseek/i, 128000],
  [/qwen/i, 131072],
  [/glm/i, 128000],
];

function estimateContextWindow(model?: string): number {
  if (!model) return 200000;
  for (const [pattern, size] of CONTEXT_WINDOWS) {
    if (pattern.test(model)) return size;
  }
  return 200000; // default
}

export async function executeSlashCommand(
  cmd: SlashCommandMatch,
  context?: {
    taskId?: string;
    modelConfig?: { model?: string };
    conversation?: Array<{ role: string; content: string }>;
  },
): Promise<string> {
  switch (cmd.name) {
    case 'new':
      return '✅ 已开启新对话。之前的上下文已清除，请开始新的提问。';

    case 'reset':
      return '✅ 已重置会话。上下文和短期记忆已清除。\n\n长期记忆保留不变，我仍然记得你的偏好。';

    case 'status': {
      const model = context?.modelConfig?.model || '(未配置)';
      const conv = context?.conversation || [];
      const turns = Math.floor(conv.length / 2);
      const totalTokens = conv.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
      const contextWindow = estimateContextWindow(model);
      const usagePct = contextWindow > 0 ? ((totalTokens / contextWindow) * 100).toFixed(1) : '?';

      return `**📊 当前会话状态**

🧠 模型：${model}

💬 对话轮次：${turns} 轮（${conv.length} 条消息）

📊 上下文用量：≈${totalTokens.toLocaleString()} / ${(contextWindow / 1000).toFixed(0)}K tokens（${usagePct}%）`;
    }

    case 'compact': {
      const conv = context?.conversation || [];
      const convTurns = Math.floor(conv.length / 2);
      if (convTurns < 3) {
        return `⚠️ 当前对话仅 ${convTurns} 轮，无需压缩（至少需要 3 轮）。`;
      }
      try {
        const { manualCompact } = await import('@/shared/context/assembler');
        const taskId = context?.taskId || 'desktop';
        console.log(`[SlashCommand] compact: ${convTurns} turns, ${conv.length} messages, taskId=${taskId}`);
        const result = await manualCompact(taskId, conv);
        if (result.ok) {
          const reduction = result.tokensBefore > 0
            ? Math.round((1 - result.tokensAfter / result.tokensBefore) * 100)
            : 0;
          return `✅ 上下文已压缩（非破坏性，原始消息保留）

📊 Token：${result.tokensBefore.toLocaleString()} → ${result.tokensAfter.toLocaleString()}（减少 ${reduction}%）

下次对话时，模型将看到压缩摘要 + 最近 3 轮对话，而不是全部历史。

${result.summary.slice(0, 300)}${result.summary.length > 300 ? '...' : ''}`;
        }
        return '⚠️ 压缩失败，请稍后重试。';
      } catch (err) {
        console.error('[SlashCommand] compact error:', err);
        return '⚠️ 压缩失败，请稍后重试。';
      }
    }

    case 'help':
      return `**📋 可用命令：**

/new — 开启新对话，清除当前上下文

/reset — 重置会话（清除上下文+短期记忆）

/status — 查看当前模型、会话状态

/compact — 手动压缩上下文

/help — 显示此帮助信息

💡 直接发送消息即可正常对话。`;

    default:
      return `未知命令：/${cmd.name}`;
  }
}
