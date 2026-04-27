# Sage — Claude Code 项目笔记

## 项目概览

Sage 是一个 AI 金融助手桌面应用。Tauri 2 + React 19 前端，Hono HTTP Sidecar（Node.js）后端，使用 `@codeany/open-agent-sdk`。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust) |
| 前端 | React 19 + Vite + TailwindCSS |
| 后端 Sidecar | Hono + Node.js，编译为独立二进制 |
| Agent SDK | `@codeany/open-agent-sdk`（位于 `src-api/node_modules/@codeany/open-agent-sdk`） |
| 数据库 | 本地 SQLite + Supabase（云同步） |
| 图表 | ECharts (K 线/分时/柱/线/热力) + lightweight-charts (备选) |

## 关键文件路径

| 文件 | 作用 |
|------|------|
| `src-api/src/extensions/agent/codeany/index.ts` | Agent 适配器主文件（plan/run/processMessage、工具拦截、artifact 生成） |
| `src/shared/hooks/useAgent.ts` | 前端请求路由（决定走 chat/agent/plan+execute 哪条路径） |
| `src/app/pages/TaskDetail.tsx` | 会话消息渲染（TextMessageItem、artifact 提取） |
| `src/components/htui/ArtifactRenderer.tsx` | Artifact 组件渲染器（13 个 HTUIKit 组件分发） |
| `src/shared/config/artifactMapping.ts` | URL→artifact 类型映射 |
| `src-api/resources/skills/` | 17 个内置金融技能的 SKILL.md 和配置 |
| `src-api/resources/defaults/AGENTS.md` | Agent 工作流规范 |
| `src-api/resources/defaults/SOUL.md` | 角色设定 |

## 构建与部署

```bash
pnpm build:api           # TS→JS 编译（不生成二进制）
pnpm build:api:binary:mac-arm   # 生成 sage-api 独立二进制
pnpm tauri:build:mac-arm        # 完整 .app 打包（含前端+后端二进制）
```

**注意**: 桌面 App 运行的是 `.app/Contents/MacOS/sage-api` 二进制，不是 tsx 源码。改了后端代码必须重新生成二进制并打包，或至少复制新二进制到 `.app` 目录。

## 前端请求路由（useAgent.ts 决策树）

```
用户提问 →
  ├─ isAnthropicApi && isFastChatQuery → /agent/chat (快聊，run())
  ├─ hasImages || isOpenAiProvider     → /agent (直接 run()，跳过 plan)
  └─ 其他                             → /agent/plan → /agent/execute (两阶段)
```

- MiniMax 等 OpenAI-format provider 走 `isOpenAiProvider` 分支，直接 `run()`，不走 plan 阶段。

## 工具输出拦截机制（PostToolUse Hook）

在 `index.ts` 中通过 SDK 的 `PostToolUse` hook 实现确定性拦截：

1. **Layer 1**: URL/route 模式匹配（`detectFromCommand()`）
2. **Layer 2**: JSON 响应结构匹配（`detectFromResponseStructure()`）
3. **Layer 0**: `_metadata` 字段 fallback

拦截后：
- `transformForComponent()` 将 API 响应格式转为前端组件数据格式
- `generateSummary()` 生成简洁摘要（100~200 字符）替换原始 tool_output，节省 token
- artifact block 推入 `pendingArtifacts` 队列，在 `processMessage()` 中 flush

## SDK 补丁（已修改的 node_modules 文件）

| 文件 | 改动 |
|------|------|
| `@codeany/open-agent-sdk/dist/hooks.js` | 新增 `modifiedOutput` 字段 |
| `@codeany/open-agent-sdk/dist/engine.js` | PostToolUse 应用 modifiedOutput |
| `@codeany/open-agent-sdk/dist/hooks.d.ts` | 类型声明更新 |

## 经验教训

> **修改 Agent 行为前，先从 `useAgent.ts` 的路由入口追到 `engine.ts` 的 agentic loop，画清完整链路再动手。不要从中间层开始改。**

- 曾尝试在 `plan()` 方法中加 synthetic plan/isAnnounceOnly 等逻辑处理 MiniMax "只说不做"问题，导致前端 UI 结构混乱（raw JSON 泄漏到 UI）。最终正确方案极其简单：在 `useAgent.ts` 加一行 `isOpenAiProvider` 判断跳过 plan 阶段。
- Artifact 空壳闪烁有两个原因：① `React.lazy()` Suspense 延迟（已改高频组件为静态 import）；② API 响应格式 ≠ 组件数据格式（需要 `transformForComponent()` 转换）。
- API 错误响应（如 `{"code": -1, "msg": "鉴权失败"}`）也会被结构匹配误拦截，需检查 `parsed.code !== 0 && !parsed.data` 提前退出。

## 待办事项

### P1 — MiniMax 不遵循 SKILL.md artifact 选择规则
分时查询应走 `intraday-chart`，但 MiniMax 声称"没有分时图组件"。根因是 LLM reasoning 跳过 SKILL.md 检索。候选方案：提到 system prompt 顶层 / 加 few-shot / 后置 guard / 换模型。

### P2 — 意图识别驱动的执行策略分层
当前 `useAgent.ts` 只有粗粒度的二档路由（快聊 vs plan+execute）。目标是引入三层策略：
- **直接执行**：意图明确的单步查询（「茅台现在多少钱」），零 plan 开销
- **静默 plan**：多步但无歧义（「对比茅台和五粮液走势」），内部 plan 不暴露给用户
- **显式 plan + 确认**：有副作用或高成本模糊意图（创建定时任务、批量分析）

实现思路：混合方案 — 规则层先拦 90% 简单查询（扩展 `isFastChatQuery`），拦不住的再考虑 LLM 分类。工作量较大，需改 `useAgent.ts` 路由 + 后端 plan 判断逻辑 + 可能涉及前端 UI 流程。

### P3 — 恢复 Windows x64 发布
WiX 对中文产品名有 encoding bug。NSIS 已成功，给 Windows job 加 `--bundles nsis` 即可恢复。约 15 分钟工作量。
