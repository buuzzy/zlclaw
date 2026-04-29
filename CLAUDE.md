# Sage — Claude Code 项目笔记

## 项目概览

Sage 是一个 AI 金融助手，支持桌面端（macOS）和移动端（iOS）。桌面端用 Tauri 2，iOS 端用 Capacitor，共享同一套 React 19 前端代码。

## 技术栈

| 层 | 桌面端 | iOS 端 |
|---|---|---|
| 壳 | Tauri 2 (Rust) | Capacitor 8 |
| 前端 | React 19 + Vite + TailwindCSS | 同左（共享 `src/`） |
| 后端 | Hono sidecar (localhost:2026) | Railway 云端 (`zlclaw-production.up.railway.app`) |
| Agent SDK | `@codeany/open-agent-sdk` | 同左（后端共享） |
| 数据库 | 本地 SQLite + Supabase | 纯 Supabase |
| 图表 | ECharts (K线/柱/线/热力) + lightweight-charts | 同左 |
| 认证 | OAuth (GitHub/Google) via deep-link | 邮箱/密码（OAuth 待适配） |

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
| `capacitor.config.ts` | Capacitor iOS 配置 |
| `ios/` | Capacitor 生成的 Xcode 项目 |
| `Dockerfile` | Railway 部署用多阶段构建 |
| `.env.ios` | iOS 构建环境变量（VITE_API_URL） |

## 项目目录结构

```
sage/
├── src/                ← React 前端（桌面 + iOS 共享）
├── src-api/            ← Hono 后端（桌面本地 sidecar / iOS 走 Railway）
├── src-tauri/          ← Tauri 桌面壳（Rust）
├── ios/                ← Capacitor iOS 壳（Xcode 项目）
├── capacitor.config.ts ← Capacitor 配置
├── Dockerfile          ← Railway 部署
└── docs/
    ├── TODO.md
    └── ios/IOS_PLAN.md ← iOS 完整方案文档
```

## 构建与部署

```bash
pnpm build:api           # TS→JS 编译（不生成二进制）
pnpm build:api:binary:mac-arm   # 生成 sage-api 独立二进制
pnpm tauri:build:mac-arm        # 完整 .app 打包（含前端+后端二进制）
pnpm build:ios                  # iOS: 前端构建 + cap sync
pnpm open:ios                   # 打开 Xcode iOS 项目
```

**桌面端注意**: App 运行的是 `.app/Contents/MacOS/sage-api` 二进制，不是 tsx 源码。改了后端代码必须重新生成二进制并打包。

**iOS 端注意**: 每次改前端代码后需要 `pnpm build:ios` 重新构建同步到 Xcode，然后在 Xcode 里 ▶️ 运行。`.env.ios` 包含 `VITE_API_URL` 指向 Railway。

## 平台差异处理

### API 地址（`src/config/index.ts`）
```typescript
const isTauri = '__TAURI_INTERNALS__' in window;
export const API_BASE_URL = isTauri
  ? 'http://localhost:2026'          // 桌面端本地 sidecar
  : import.meta.env.VITE_API_URL;     // iOS/Web → Railway
```

### 认证（`src/shared/providers/auth-provider.tsx`）
- **桌面端**: OAuth → 系统浏览器 → deep-link (`sage://auth/callback`) 回调
- **iOS 端**: 邮箱/密码登录（`signInWithPassword`）。OAuth 在 Capacitor WebView 内未完成适配（deep-link 回调不通）
- **Supabase client** (`src/shared/lib/supabase.ts`): `detectSessionInUrl` 和 `flowType` 按 `isTauri` 分叉

### 鉴权（`src-api/src/app/middleware/local-only.ts`）
- `SAGE_API_TOKEN` 环境变量设置时 → Bearer token 鉴权（Railway 云端）
- 未设置时 → loopback IP 检测（桌面端 sidecar）

### Railway 部署
- URL: `https://zlclaw-production.up.railway.app`
- 环境变量: `SAGE_API_TOKEN`（Bearer auth）
- Dockerfile 在项目根目录，多阶段构建（pnpm bundle → node:20-alpine）
- Railway Hobby Plan $5/月，含 $5 credit，可设 Hard Limit 防超支

## iOS 当前状态（Phase 0 完成）

- ✅ Capacitor 项目初始化，模拟器可运行
- ✅ 邮箱/密码登录可用
- ✅ 能进入主界面
- ⚠️ UI 未适配移动端（桌面版 UI 挤在手机屏幕上）
- ⚠️ OAuth (GitHub/Google) 在 iOS WebView 内回调不通，暂用邮箱登录
- ⚠️ 本地 SQLite 等桌面功能在 iOS 上静默失败（不影响对话）
- **下一步: iOS UI 适配**（侧边栏→底部 Tab Bar、移动端布局、Safe Area、虚拟键盘）
- 详细方案: `docs/ios/IOS_PLAN.md`

## 前端请求路由（useAgent.ts 决策树）

```
用户提问 →
  ├─ isDirectExecuteQuery (简单金融查询) → /agent (直接 run()，跳过 plan)
  ├─ hasImages                          → /agent (直接 run()，跳过 plan)
  └─ 其他                               → /agent/plan → /agent/execute (两阶段)
```

- v1.0.4 起移除了 fast chat 路径，所有查询统一走 Agent + 工具链路
- MiniMax 已切换到 Anthropic Messages 协议（`api.minimaxi.com/anthropic`），不再走 OpenAI-format

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
- MiniMax 在 OpenAI-format 下会对简单问题泛滥调用工具（73 次 tool calls），根因是协议不匹配。切换到 Anthropic Messages 协议后彻底解决。
- Fast chat 路径看似节省 token，但制造了能力边界问题（"没有该能力"）。移除后所有查询走 Agent + 工具，用户体验反而更好。
- iwencai API 升级后需要 X-Claw-* 系列 Header，否则 401。注意两类端点格式不同：`/v1/query2data`（8 个数据查询技能）vs `/v1/comprehensive/search`（新闻/公告/研报 3 个搜索技能）。
- API Key 不要硬编码在源码中。公共仓库 + 硬编码 = 立即泄露。用 `.env` + gitignore。清理 git 历史用 `git-filter-repo --replace-text`。

## 待办事项

### P1 — MiniMax 不遵循 SKILL.md artifact 选择规则
分时查询应走 `intraday-chart`，但 MiniMax 声称"没有分时图组件"。根因是 LLM reasoning 跳过 SKILL.md 检索。候选方案：提到 system prompt 顶层 / 加 few-shot / 后置 guard / 换模型。

### P2 — 意图识别驱动的执行策略分层
当前 `useAgent.ts` 有两档路由（直接执行 vs plan+execute）。目标是引入三层策略：
- **直接执行**：意图明确的单步查询（「茅台现在多少钱」），零 plan 开销
- **静默 plan**：多步但无歧义（「对比茅台和五粮液走势」），内部 plan 不暴露给用户
- **显式 plan + 确认**：有副作用或高成本模糊意图（创建定时任务、批量分析）

### P3 — 恢复 Windows x64 发布
产品已更名为 Sage（纯英文），WiX 中文编码 bug 不再是阻碍。给 CI Windows job 加 `--bundles nsis` 即可恢复。

## API Key 管理

金融数据 API Key 不在源码中硬编码，通过环境变量加载：

| Key | 用途 | 加载方式 |
|-----|------|----------|
| `IWENCAI_API_KEY` | 11 个 iwencai 技能 | `~/.sage/.env` → Tauri sidecar 注入 |
| `WESTOCK_API_KEY` | 4 个 westock 技能 | 同上 |

Tauri 启动 sidecar 时从 `~/.sage/.env` 读取并传递环境变量（`src-tauri/src/lib.rs` 中的 `load_dotenv()`）。
Railway 部署需在环境变量中单独配置。

签名密钥：`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，本地构建时手动 export，密钥文件存放于 `~/Documents/Projects/sage-tauri-signing-key-v2.txt`。
