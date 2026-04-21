# Sage 技术规格文档

> 版本：v1.0.0
> 日期：2026-04-21

---

## 1. 产品定位

**Sage** 是一款垂直金融领域桌面 AI Agent，定位为**个人投资者的智能金融助手**。

核心能力：自然语言金融数据查询、行情可视化、资讯追踪、AI 辅助研究、定时推送、记忆归纳。

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                   Sage 桌面应用                               │
│               (Tauri 2 + React 19 + Vite 7)                 │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    Main Window                         │  │
│  │  ┌──────────────────┬─────────────────────────────┐   │  │
│  │  │   Chat Panel     │  HTUIKit 金融可视化组件（13）  │  │
│  │  │   (对话 + 流式)  │  QuoteCard / KLineChart     │   │  │
│  │  │                  │  BarChart / LineChart        │   │  │
│  │  │   Artifact       │  DataTable / NewsCard       │   │  │
│  │  │   Parser ──────→ │  StockSnapshot / SectorHeatmap│  │  │
│  │  │                  │  ResearchConsensus / FinancialHealth│ │
│  │  │                  │  NewsFeed (按 artifact:TYPE 渲染) │  │
│  │  └──────────────────┴─────────────────────────────┘   │  │
│  │  ContextUsageRing (输入框旁，实时上下文用量指示)         │  │
│  └────────────────────────────────────────────────────────┘  │
│                       ↕ HTTP + SSE                            │
└───────────────────────┬──────────────────────────────────────┘
                        │ 127.0.0.1:2026
┌───────────────────────┴──────────────────────────────────────┐
│  Hono HTTP Sidecar (sage-api)                                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  @codeany/open-agent-sdk (Agent Runtime)               │  │
│  │                                                        │  │
│  │  ├── SOUL.md + AGENTS.md (人设 + 工作流 + Artifact 协议)│  │
│  │  ├── 17 个金融技能 (~/.sage/skills/)                   │  │
│  │  ├── 记忆系统 (向量语义检索 + 每日归档 + 23:00 归纳)    │  │
│  │  ├── Cron 定时调度器 (持久化 + Agent 工具 + UI 管理)    │  │
│  │  ├── Channel 适配器 (微信 WeClaw / 飞书)               │  │
│  │  ├── OpenAI 兼容端点 (/v1/chat/completions)            │  │
│  │  ├── Sandbox (claude-code / codex / native)            │  │
│  │  └── MCP Server 支持                                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ├── iwencai Open API ←── 金融数据                           │
│  └── LLM Provider (MiniMax / OpenRouter / Kimi / ...) ←── 推理│
└──────────────────────────────────────────────────────────────┘
```

### 架构原则

1. **进程分离**：Hono Sidecar 与桌面 UI 解耦，独立运行，桌面 UI 仅负责展示与交互
2. **垂直扩展**：在 Sidecar + Skills + Agent Config 之上扩展金融能力，不改动核心路由与 SDK 契约
3. **Artifact 驱动**：Agent 输出 `artifact:TYPE` 标记，前端 ArtifactParser 提取并路由到对应组件渲染
4. **开箱即用**：17 个金融技能内置于 app bundle，首次启动自动初始化 `~/.sage/` 目录树

---

## 3. 技术选型

### 3.1 桌面应用框架

| 技术 | 版本 | 选择理由 |
|------|------|---------|
| Tauri 2 | 2.x | 跨平台（macOS + Windows + Linux），包体积小 |

### 3.2 前端

| 组件 | 技术 | 版本 |
|------|------|------|
| UI Framework | React | 19 |
| Language | TypeScript | 5.8 |
| Build Tool | Vite | 7 |
| Styling | Tailwind CSS | 4 |
| UI 组件库 | Ant Design | 6 + Radix UI |
| K 线图表 | TradingView Lightweight Charts | 5 |
| 通用图表 | ECharts + echarts-for-react | 6 |
| Markdown | react-markdown + remark-gfm | 9 |
| 图标 | lucide-react + @ant-design/icons | - |

### 3.3 后端 (Sidecar)

| 组件 | 技术 | 版本 |
|------|------|------|
| Runtime | Node.js | ≥ 22 |
| HTTP 框架 | Hono + @hono/node-server | 4.x |
| Agent Engine | @codeany/open-agent-sdk | 0.2.x |
| LLM SDK | @anthropic-ai/sdk | 0.78+ |
| MCP | @modelcontextprotocol/sdk | 1.25+ |
| 打包 | esbuild → @yao-pkg/pkg（单二进制） | - |

### 3.4 数据源

| 数据 | 来源 | 覆盖范围 |
|------|------|---------|
| 金融数据 | iwencai Open API（同花顺问财） | A 股/港股/美股/指数/基金/债券/期货/宏观 |
| 技能数量 | 12 个 iwencai 技能 + 5 个 westock 技能 | 行情/指数/基本资料/财务/经营/基金/新闻/研报/公告/宏观/行业/定时任务/网页访问 |

---

## 4. 功能模块

### 4.1 Chat Panel（对话面板）

- 接收用户自然语言输入
- Agent SSE streaming 回复（流式文本 + 工具调用日志）
- Markdown 渲染 + Artifact 内嵌可视化组件
- 工具调用折叠展示（ToolCallsCollapse）
- 多会话管理，全量历史持久化至 `~/.sage/sessions/{id}.json`

### 4.2 HTUIKit（金融可视化组件库，13 个）

| 组件 | Artifact 类型 | 渲染引擎 |
|------|--------------|---------|
| QuoteCard | `quote-card` | 原生 React |
| KLineChart | `kline-chart` | Lightweight Charts v5 |
| BarChart | `bar-chart` | ECharts |
| LineChart | `line-chart` | ECharts |
| DataTable | `data-table` | Ant Design Table |
| NewsCard | `news-list` | 原生 React |
| AIHotNews | `ai-hot-news` | 原生 React |
| FinanceBreakfast | `finance-breakfast` | 原生 React |
| StockSnapshot | `stock-snapshot` | 原生 React + SVG |
| SectorHeatmap | `sector-heatmap` | ECharts Treemap |
| ResearchConsensus | `research-consensus` | 原生 React |
| FinancialHealth | `financial-health` | 原生 React |
| NewsFeed | `news-feed` | 原生 React |

所有组件通过 `React.lazy()` 按需加载，独立拆包。

### 4.3 Artifact 标记协议

Agent 在回复文本中嵌入 fenced code block：

~~~
```artifact:TYPE
{...JSON 数据...}
```
~~~

前端 `artifactParser.ts` 实时提取 artifact 块，`ArtifactRenderer.tsx` 根据 TYPE 路由到对应组件。

### 4.4 HTTP/SSE 通信

- **上行**：`POST /agent`（桌面端）或 `POST /v1/chat/completions`（渠道端）
- **下行（SSE）**：`token` / `tool_call` / `tool_result` / `done`
- Artifact 数据嵌入在 token 流的文本中，由前端解析

### 4.5 对话智能路由

| 路由 | 触发条件 |
|------|---------|
| Fast Chat | 闲聊/简单问答，直接 LLM 回复 |
| Direct Execute | 简单金融查询，跳过 plan 阶段 |
| Plan → Execute | 复杂多步任务，先规划再执行 |

### 4.6 记忆系统（三层架构）

| 层级 | 文件 | 策略 |
|------|------|------|
| 用户画像 | `~/.sage/user.md` | 永久保留，检索权重 ×1.2 |
| 长期记忆 | `~/.sage/MEMORY.md` | 永久保留，检索权重 ×1.3 |
| 每日归档 | `~/.sage/memory/YYYY-MM-DD.md` | 热层（0-30天完整索引），过期从索引移除 |
| 向量索引 | `~/.sage/memory-index/` | Embedding + 余弦相似度 + BM25 混合检索 |

- 每次回复后自动追加日文件（用户 ≤200，助手 ≤300 字符）
- 每晚 23:00 自动归纳当日对话要点写入 MEMORY.md（LLM 四节结构化摘要）
- 每次请求按查询语义检索 top-8 片段注入 system prompt

### 4.7 Cron 定时调度器

| 功能 | 说明 |
|------|------|
| 调度类型 | cron 表达式 / 固定间隔（every）/ 一次性任务（at） |
| 持久化 | `~/.sage/cron/jobs.json`，重启自动恢复 |
| 执行 | isolated Agent run（独立上下文，最多保留10条历史） |
| Channel 推送 | `targetConversationId` 推送结果到飞书会话 |
| Jitter | 执行抖动（0–3600s），防止整点堆积 |
| 系统 Job | `sys-memory-consolidation`（每天 23:00，不可删除） |

### 4.8 技能管理

- 技能包内置于 `src-api/resources/skills/`（17 个，随 app bundle 分发）
- 首次启动由 `installBuiltinSkills()` 自动复制到 `~/.sage/skills/`（已存在则跳过）
- `~/.sage/skills-config.json` 管理启用/禁用
- 前端 SkillsSettings 提供 per-skill 开关
- 自定义技能：放入 `~/.sage/skills/{name}/SKILL.md` 后重启生效

### 4.9 Channel 适配器

| 渠道 | 实现 | 端点 |
|------|------|------|
| 桌面端 | 直连 Sidecar | `POST /agent` (SSE) |
| 微信 (WeClaw) | OpenAI 兼容 | `POST /v1/chat/completions` |
| 飞书 | FeishuAdapter | WebSocket 长连接 |

飞书功能：Streaming Card、Schema 2.0 Markdown 卡片、媒体自动下载、速率限制指数退避（3次重试）

### 4.10 首次启动初始化

`ensureAppDirInitialized()` 在 `index.ts` 最前面（`loadConfig()` 之前）运行，幂等安全：

1. 创建 `~/.sage/` 目录树（skills/sessions/memory/logs/cache/cron）
2. 自动迁移旧版 `~/.htclaw/` 数据（拷贝 + `.migrated` 标记，不删原数据）
3. 安装内置默认文件（`AGENTS.md`/`SOUL.md`/`skills-config.json`），已存在则跳过
4. 创建骨架文件（`mcp.json`/`user.md`/`MEMORY.md`），已存在则跳过

### 4.11 安全

- **localOnlyMiddleware**：管理路由（`/memory/*`/`/cron/*`/`/settings/*`）受 TCP 回环检测保护，
  拒绝来自非 127.x/::1 的请求
- **Channel API Key**：渠道端请求需携带 `channelApiKey`（`~/.sage/config.json` 配置）

---

## 5. 项目目录结构

```
htclaw-app/                        # 主应用 (pnpm monorepo)
├── src/                           # React 前端
│   ├── app/pages/                 #   页面 (Home / TaskDetail / Setup / Library)
│   ├── components/
│   │   ├── htui/                  #   HTUIKit 金融可视化组件 (13 个)
│   │   ├── artifacts/             #   通用文件预览 (PDF/DOCX/XLSX/代码/图片)
│   │   ├── settings/              #   设置面板 (模型/技能/渠道/记忆/Cron/MCP/关于)
│   │   ├── shared/                #   共享组件 (ContextUsageRing/FeedbackButton/...)
│   │   ├── task/                  #   任务详情 (PlanApproval/ToolExecution/...)
│   │   ├── home/                  #   首页
│   │   └── ui/                    #   基础 UI (Button/Dialog/Tooltip/...)
│   ├── shared/
│   │   ├── lib/                   #   artifactParser / format / paths / utils
│   │   ├── types/artifact.ts      #   Artifact 类型定义（13 个组件）
│   │   ├── hooks/                 #   useAgent / useChannelSync / useProviders
│   │   ├── db/                    #   SQLite 持久化 (settings.ts / database.ts)
│   │   └── providers/             #   Theme / Antd / Language Provider
│   └── config/                    #   全局配置 / 样式 / 国际化
│
├── src-api/                       # Hono Sidecar 后端
│   ├── src/
│   │   ├── app/api/               #   HTTP 路由（agent/completions/skills/memory/cron/...）
│   │   ├── core/                  #   Agent/Channel/Sandbox 抽象层
│   │   ├── extensions/            #   CodeAny Agent / 飞书适配器 / Sandbox 实现
│   │   ├── shared/
│   │   │   ├── memory/            #   向量记忆 (embedding/chunker/search/indexer/consolidator)
│   │   │   ├── skills/            #   技能加载/注册/配置
│   │   │   ├── cron/              #   Cron 调度器 (scheduler/store/types)
│   │   │   ├── init/              #   首次启动初始化 (first-run.ts / migration.ts)
│   │   │   └── services/          #   agent / chat / channel-store / preview
│   │   └── config/                #   prompt-loader / constants
│   └── resources/
│       ├── defaults/              #   内置默认文件 (AGENTS.md / SOUL.md / skills-config.json)
│       └── skills/                #   内置技能 (17 个，随 app bundle 分发)
│
└── src-tauri/                     # Rust 桌面壳
    ├── src/main.rs + lib.rs
    ├── tauri.conf.json
    └── Cargo.toml
```

---

## 6. Bundle 优化

| 策略 | 说明 |
|------|------|
| Vendor 分包 | 7 个 manualChunks：react / antd / echarts / charts / markdown / syntax / office |
| 组件懒加载 | 13 个 HTUIKit 组件 `React.lazy()` 按需加载，每个 1-2KB 独立 chunk |
| 主 chunk 瘦身 | index chunk 从 ~1,769KB → ~619KB |

---

## 7. 生产构建与分发

| 平台 | 构建命令 | 产物 |
|------|---------|------|
| macOS ARM（发布） | `pnpm build:app:mac-arm:release` | `Sage_1.0.0_aarch64.dmg` |
| macOS ARM | `pnpm build:app:mac-arm` | `.app` + `.dmg` |
| macOS Intel | `pnpm build:app:mac-intel` | `.app` + `.dmg` |
| Windows x64 | `pnpm build:app:windows` | `.exe` + `.msi` |
| Linux x64 | `pnpm build:app:linux` | `.AppImage` + `.deb` |

- API sidecar (`sage-api`) 通过 esbuild + pkg 打包为单二进制，嵌入 Tauri bundle
- `--with-claude`/`--with-cli`：同时打包 Claude Code + Codex CLI（471M，共享 Node.js）
- `--sign`：启用 macOS 代码签名（需 Apple Developer 证书）

---

## 8. 环境要求

| 组件 | 要求 |
|------|------|
| Node.js | ≥ 22 |
| pnpm | ≥ 10 |
| Rust | ≥ 1.70（仅桌面打包） |
| macOS | ≥ 11 (Big Sur) |
| Windows | ≥ 10 (x64) |
| Linux | x86_64, glibc ≥ 2.31 |

---

## 9. 运行时数据目录

所有运行时数据存放于 `~/.sage/`（首次启动自动创建）：

| 文件/目录 | 用途 |
|----------|------|
| `config.json` | 环境配置（API Key、LLM 配置、渠道配置） |
| `skills-config.json` | 技能启用/禁用名单 |
| `SOUL.md` / `AGENTS.md` | Agent 人设与工作流 |
| `user.md` | 用户画像 |
| `MEMORY.md` | 长期记忆 |
| `mcp.json` | MCP Server 配置 |
| `skills/` | 技能包（内置 17 个 + 用户自定义） |
| `sessions/` | 会话历史（`{id}.json`） |
| `memory/` | 每日对话归档（`YYYY-MM-DD.md`） |
| `memory-index/` | 向量索引 |
| `cron/` | 定时任务数据（`jobs.json`） |
| `cache/` | 临时缓存 |
| `logs/` | 运行日志 |

### config.json 结构

```json
{
  "env": {
    "IWENCAI_API_KEY": "sk-proj-..."
  },
  "channels": {
    "feishu": {
      "enabled": false,
      "connectionMode": "websocket",
      "appId": "",
      "appSecret": ""
    },
    "wechat": {
      "enabled": false
    }
  },
  "channelApiKey": "",
  "agentConfig": {
    "apiKey": "...",
    "baseUrl": "https://api.minimaxi.com/v1",
    "model": "MiniMax-M1",
    "apiType": "openai-completions"
  },
  "defaultProvider": "minimax",
  "defaultModel": "MiniMax-M1"
}
```
