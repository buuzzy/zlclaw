# HT Claw 技术规格文档

> 版本：v0.1.5
> 日期：2026-04-20

---

## 1. 产品定位

**HT Claw** 是一款垂直金融领域桌面 AI Agent，定位为**个人投资者的智能金融助手**。

核心能力：自然语言金融数据查询、行情可视化、资讯追踪、AI 辅助研究、定时推送、记忆归纳。

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                  HT Claw 桌面应用                             │
│               (Tauri 2 + React 19 + Vite 7)                 │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    Main Window                         │  │
│  │  ┌──────────────────┬─────────────────────────────┐   │  │
│  │  │   Chat Panel     │  HTUIKit 金融可视化组件      │   │  │
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
│  Hono HTTP Sidecar (htclaw-api)                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  @codeany/open-agent-sdk (Agent Runtime)               │  │
│  │                                                        │  │
│  │  ├── SOUL.md + AGENTS.md (人设 + 工作流 + Artifact 协议)│  │
│  │  ├── 11 个 iwencai 金融技能 (~/.htclaw/skills/)        │  │
│  │  ├── 记忆系统 (向量语义检索 + 每日归档 + 23:00 归纳)    │  │
│  │  ├── Cron 定时调度器 (持久化 + Agent 工具 + UI 管理)    │  │
│  │  ├── Channel 适配器 (微信 WeClaw / 飞书)               │  │
│  │  ├── OpenAI 兼容端点 (/v1/chat/completions)            │  │
│  │  ├── Sandbox (脚本执行)                                │  │
│  │  └── MCP Server 支持                                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ├── iwencai Open API ←── 金融数据                           │
│  └── LLM Provider (Anthropic / OpenAI / 兼容) ←── 推理      │
└──────────────────────────────────────────────────────────────┘
```

### 架构原则

1. **进程分离**：Hono Sidecar 与桌面 UI 解耦，Sidecar 独立运行，桌面 UI 仅负责展示与交互
2. **垂直扩展**：在 Sidecar + Skills + Agent Config 之上扩展金融能力，不改动 Sidecar 核心路由与 SDK 公共契约
3. **Artifact 驱动**：Agent 输出 `artifact:TYPE` 标记，前端 ArtifactParser 提取并路由到对应 HTUIKit 组件渲染
4. **开箱即用**：iwencai API Key 预置于 `~/.htclaw/config.json`，用户无需手动配置即可使用金融数据

---

## 3. 技术选型

### 3.1 桌面应用框架

| 技术 | 版本 | 选择理由 |
|------|------|---------|
| Tauri 2 | 2.x | 跨平台（macOS + Windows + Linux），包体积小（DMG ~35MB） |

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
| 打包 | esbuild → @yao-pkg/pkg (单二进制) | - |

### 3.4 数据源

| 数据 | 来源 | 覆盖范围 |
|------|------|---------|
| 金融数据 | iwencai Open API（同花顺问财） | A 股/港股/美股/指数/基金/债券/期货/宏观 |
| 技能数量 | 11 个 iwencai 技能包 | 行情/指数/基本资料/财务/经营/基金/新闻/研报/公告/宏观/行业 |

---

## 4. 功能模块

### 4.1 Chat Panel（对话面板）

- 接收用户自然语言输入
- Agent SSE streaming 回复（流式文本 + 工具调用日志）
- Markdown 渲染 + Artifact 内嵌可视化组件
- 工具调用折叠展示（ToolCallsCollapse）
- 多会话管理

### 4.2 HTUIKit（金融可视化组件库）

| 组件 | Artifact 类型 | 渲染引擎 | 说明 |
|------|--------------|---------|------|
| QuoteCard | `quote-card` | 原生 React | 实时行情卡片（代码/名称/价格/涨跌幅/高低/成交量） |
| KLineChart | `kline-chart` | Lightweight Charts v5 | 日/周/月 K 线，支持 MA 均线叠加 |
| BarChart | `bar-chart` | ECharts | 柱状图（财务对比/行业排名/分组对比） |
| LineChart | `line-chart` | ECharts | 折线图（趋势分析/收益率走势/多线对比） |
| DataTable | `data-table` | Ant Design Table | 数据表格（财报/研报/公告/基金列表） |
| NewsCard | `news-list` | 原生 React | 新闻列表（标题/摘要/标签/时间） |
| AIHotNews | `ai-hot-news` | 原生 React | AI 热闻（保留，当前不主动生成） |
| FinanceBreakfast | `finance-breakfast` | 原生 React | 财经早餐（Cron 定时生成推送） |
| StockSnapshot | `stock-snapshot` | 原生 React + SVG | 个股快照（大字价格 + sparkline + 估值三表 + 分析师评级） |
| SectorHeatmap | `sector-heatmap` | ECharts Treemap | 板块热力图（颜色=涨跌幅，面积=成交额） |
| ResearchConsensus | `research-consensus` | 原生 React | 研报评级汇总（评级分布横条 + 目标价区间 + 研报列表） |
| FinancialHealth | `financial-health` | 原生 React | 财务健康仪表盘（4 维度 2×2 网格 + 分数条 + 摘要） |
| NewsFeed | `news-feed` | 原生 React | 情绪新闻流（Timeline 竖线 + 情绪圆点 + 关联股票） |

所有组件通过 `React.lazy()` 按需加载，独立拆包。

### 4.3 Artifact 标记协议

Agent 在回复文本中嵌入 fenced code block：

~~~
文字分析...

```artifact:TYPE
{...JSON 数据...}
```
~~~

前端 `artifactParser.ts` 实时提取 artifact 块，`ArtifactRenderer.tsx` 根据 TYPE 路由到对应组件。

### 4.4 HTTP/SSE 通信

- **上行**：`POST /agent`（桌面端）或 `POST /v1/chat/completions`（渠道端）
- **下行（SSE）**：
  - `token`：流式文本
  - `tool_call` / `tool_result`：工具调用与结果
  - `done`：完成信号
- Artifact 数据嵌入在 token 流的文本中，由前端解析

### 4.5 对话智能路由

| 路由 | 触发条件 | 说明 |
|------|---------|------|
| Fast Chat | 闲聊/简单问答 | 直接 LLM 回复，不走 Agent |
| Direct Execute | 简单金融查询（行情/K线/新闻等） | 跳过 plan 阶段，直接执行 |
| Plan → Execute | 复杂多步任务 | 先规划再执行 |

金融关键词（50+）防止金融查询误走 Fast Chat。

### 4.6 记忆系统

| 层级 | 文件 | 说明 |
|------|------|------|
| 用户画像 | `~/.htclaw/user.md` | 姓名/职业/偏好 |
| 长期记忆 | `~/.htclaw/MEMORY.md` | 投资偏好/关注标的/重要决策 |
| 每日归档 | `~/.htclaw/memory/YYYY-MM-DD.md` | 每次回复后自动追加 |
| 向量索引 | `~/.htclaw/memory-index/` | Embedding + 余弦相似度 + BM25 混合检索 |
| 每日归纳 | Cron 23:00 | 自动提炼当日对话要点，写入长期记忆 |

**三层保留策略**：
- 热层（0–30 天）：原始日文件完整索引
- 温层：consolidator 提炼摘要 → MEMORY.md 永久保留，权重 ×1.3
- 画像层：user.md 永久保留，权重 ×1.2

`prompt-loader.ts` 每次请求时按查询语义检索 top-8 记忆片段注入 Agent system prompt。

### 4.7 Cron 定时调度器

| 功能 | 说明 |
|------|------|
| Agent 工具 | `cron_create` / `cron_list` / `cron_delete`，Agent 可直接操作定时任务 |
| 持久化 | 任务存储于 `~/.htclaw/cron-jobs.json`，重启后自动恢复 |
| 内置任务 | 每日 23:00 记忆归纳、财经早餐推送（可开关） |
| 前端管理 | 设置面板 → Cron Tab，展示任务列表，支持启用/禁用/删除 |
| 渠道感知 | 定时推送到触发任务创建的渠道（桌面/微信/飞书） |
| Jitter | 创建任务时可配置执行抖动（0–3600s），防止整点堆积 |

### 4.8 技能管理

- 技能包存放于 `~/.htclaw/skills/`，每个技能包含 `SKILL.md` + `references/`
- `registerFilesystemSkills()` 启动时加载并注册到 SDK
- `~/.htclaw/skills-config.json` 管理启用/禁用
- 前端 SkillsSettings 提供 per-skill 开关

### 4.9 Channel 适配器

| 渠道 | 实现 | 端点 |
|------|------|------|
| 桌面端 | 直连 Sidecar | `POST /agent` (SSE) |
| 微信 (WeClaw) | OpenAI 兼容 | `POST /v1/chat/completions` |
| 飞书 | FeishuAdapter | `POST /channels/feishu/webhook` |

渠道消息支持：
- 会话连续性（30 分钟窗口）
- 斜杠命令（`/new` `/reset` `/compact` `/status` `/help`）
- 持久化去重缓存（`~/.htclaw/dedup-cache.json`，跨重启有效）
- 速率限制（防止高并发冲突）
- 飞书：Streaming Card、Schema 2.0 Markdown 卡片、媒体自动下载、消息补偿（5s 间隔）

### 4.10 ContextUsageRing（上下文用量环）

- 位置：输入框左侧（仅对话页面显示）
- 展示：40×40px SVG 环形进度 + 百分比文字
- 颜色：0–50% 绿、50–80% 黄、80–100% 橙、≥100% 红
- Hover：显示 tooltip（当前 tokens / 上限 K tokens + 百分比）
- Token 估算：`ceil(content.length / 4)`（前端快速估算，无需 API）
- 上限识别：根据当前 `defaultModel` 正则匹配 `CONTEXT_WINDOWS` 映射表

### 4.11 会话历史窗口

- token 预算：12,000 tokens（桌面端会话）
- 策略：`pruneHistory()` 在每次 push 消息后触发，从最旧消息开始裁剪
- 目标：保证 Agent 的 system prompt + 历史不超出模型上限

---

## 5. 项目目录结构

```
HTclaw/
├── htclaw-app/                        # 主应用 (pnpm monorepo)
│   ├── src/                           # React 前端
│   │   ├── app/pages/                 #   页面 (Home / TaskDetail / Setup / Library)
│   │   ├── components/
│   │   │   ├── htui/                  #   HTUIKit 金融可视化组件 (13 个)
│   │   │   │   ├── QuoteCard/
│   │   │   │   ├── KLineChart/
│   │   │   │   ├── BarChart/
│   │   │   │   ├── LineChart/
│   │   │   │   ├── DataTable/
│   │   │   │   ├── NewsCard/
│   │   │   │   ├── AIHotNews/
│   │   │   │   ├── FinanceBreakfast/
│   │   │   │   ├── StockSnapshot/     #   个股快照 (sparkline + 估值)
│   │   │   │   ├── SectorHeatmap/    #   板块热力图 (ECharts Treemap)
│   │   │   │   ├── ResearchConsensus/ #   研报评级汇总
│   │   │   │   ├── FinancialHealth/  #   财务健康仪表盘
│   │   │   │   ├── NewsFeed/         #   情绪新闻流
│   │   │   │   └── ArtifactRenderer/ #   Artifact → 组件映射
│   │   │   ├── artifacts/             #   通用文件预览 (PDF/DOCX/XLSX/代码/图片/...)
│   │   │   ├── settings/              #   设置面板 (模型/技能/渠道/记忆/Cron/MCP)
│   │   │   ├── shared/                #   共享组件 (ContextUsageRing / FeedbackButton / ...)
│   │   │   ├── task/                  #   任务详情 (PlanApproval/ToolExecution/...)
│   │   │   ├── home/                  #   首页 (AgentMessages/TaskInput)
│   │   │   ├── layout/                #   布局 (Sidebar)
│   │   │   └── ui/                    #   基础 UI (Button/Dialog/Tooltip/...)
│   │   ├── shared/
│   │   │   ├── lib/                   #   artifactParser / format / paths / utils
│   │   │   ├── types/artifact.ts      #   Artifact 类型定义（13 个组件）
│   │   │   ├── hooks/                 #   useAgent / useChannelSync / useProviders
│   │   │   ├── db/                    #   IndexedDB 持久化
│   │   │   └── providers/             #   Theme / Antd / Language Provider
│   │   └── config/                    #   全局配置 / 样式 / 国际化
│   │
│   ├── src-api/                       # Hono Sidecar 后端
│   │   ├── src/
│   │   │   ├── app/api/               #   HTTP 路由
│   │   │   │   ├── agent.ts           #     Agent 对话 (SSE)
│   │   │   │   ├── completions.ts     #     OpenAI 兼容端点 + 斜杠命令 + 记忆追加
│   │   │   │   ├── skills.ts          #     技能管理 API
│   │   │   │   ├── memory.ts          #     记忆搜索/索引 API
│   │   │   │   ├── cron.ts            #     Cron 定时任务 API
│   │   │   │   ├── channels.ts        #     渠道 Webhook
│   │   │   │   ├── wechat.ts          #     WeClaw 管理
│   │   │   │   ├── providers.ts       #     LLM Provider 管理
│   │   │   │   ├── sandbox.ts         #     Sandbox 脚本执行
│   │   │   │   ├── mcp.ts             #     MCP Server 管理
│   │   │   │   └── files.ts / health.ts / preview.ts
│   │   │   ├── core/
│   │   │   │   ├── agent/             #     Agent 抽象层 (base/registry/plugin/types)
│   │   │   │   ├── channel/           #     Channel 适配器框架 (manager/types)
│   │   │   │   └── sandbox/           #     Sandbox 抽象层
│   │   │   ├── extensions/
│   │   │   │   ├── agent/codeany/     #     CodeAny Agent 实现
│   │   │   │   ├── channel/feishu.ts  #     飞书适配器
│   │   │   │   └── sandbox/           #     Sandbox 实现 (claude/codex/native)
│   │   │   ├── shared/
│   │   │   │   ├── memory/            #     向量记忆 (embedding/chunker/search/indexer/consolidator)
│   │   │   │   ├── skills/            #     技能加载/注册/配置
│   │   │   │   ├── cron/              #     Cron 调度器 (scheduler/jobs/tools)
│   │   │   │   ├── provider/          #     LLM Provider 管理
│   │   │   │   └── services/          #     agent / chat / channel-store / preview
│   │   │   └── config/                #     prompt-loader / 环境配置
│   │   ├── resources/skills/          #     内置技能 (web-access)
│   │   └── dist/                      #     构建产物 (bundle.cjs / htclaw-api binary)
│   │
│   └── src-tauri/                     # Rust 桌面壳
│       ├── src/main.rs + lib.rs
│       ├── tauri.conf.json
│       └── Cargo.toml
│
├── hT-agent-config/                   # Agent 人设与工作流配置（源码版本）
│   ├── SOUL.md                        #   金融分析师人设
│   ├── AGENTS.md                      #   工作流规范 + Artifact 协议 + 组件清单
│   ├── openclaw.json                  #   技能列表配置
│   └── _archived/                     #   已归档的旧配置
│
├── docs/                              # 项目文档
│   ├── PRD.md                         #   产品需求文档（← 你在这里）
│   ├── SPEC.md                        #   技术规格文档
│   ├── TODO.md                        #   功能待办与路线图
│   ├── HTclaw_完整系统架构指南.md      #   系统架构深度说明
│   ├── HTclaw_前端组件架构分析.md      #   前端组件架构分析
│   ├── HTclaw_后端数据结构分析.md      #   后端数据结构分析
│   ├── iwencai.md                     #   iwencai 技能安装参考
│   └── westock-data-api.md            #   westock 数据 API 参考
│
└── README.md                          # 项目快速入门（根目录）
```

---

## 6. Bundle 优化

| 策略 | 说明 |
|------|------|
| Vendor 分包 | 7 个 manualChunks：react / antd / echarts / charts / markdown / syntax / office |
| 组件懒加载 | 13 个 HTUIKit 组件 `React.lazy()` 按需加载，每个 1-2KB 独立 chunk |
| 主 chunk 瘦身 | index chunk 从 1,769KB → 558KB（降幅 68%） |

---

## 7. 生产构建与分发

| 平台 | 构建命令 | 产物 |
|------|---------|------|
| macOS ARM | `pnpm build:app:mac-arm` | `.app` + `.dmg` |
| macOS Intel | `pnpm build:app:mac-intel` | `.app` + `.dmg` |
| Windows x64 | `pnpm build:app:windows` | `.exe` + `.msi` |
| Linux x64 | `pnpm build:app:linux` | `.AppImage` + `.deb` |

- Sidecar binary (`htclaw-api`) 通过 esbuild + pkg 打包为单文件，嵌入 Tauri bundle
- GitHub Actions CI 已配置四平台原生构建
- macOS 签名与公证：`--sign` 参数，需配置 Apple Developer 证书

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

## 9. 运行时配置

### 9.1 数据目录

所有运行时数据存放于 `~/.htclaw/`：

| 文件/目录 | 用途 |
|----------|------|
| `config.json` | 环境配置（API Key、渠道配置） |
| `skills-config.json` | 技能启用/禁用名单 |
| `SOUL.md` / `AGENTS.md` | Agent 人设与工作流（运行时副本） |
| `user.md` | 用户画像 |
| `MEMORY.md` | 长期记忆 |
| `cron-jobs.json` | 定时任务列表 |
| `dedup-cache.json` | 消息去重缓存（跨重启持久化） |
| `skills/` | iwencai 技能包（11 个） |
| `memory/` | 每日对话归档 |
| `memory-index/` | 向量索引 + Embedding 配置 |
| `sessions/` | 会话数据 |
| `logs/` | 运行日志 |

### 9.2 config.json 结构

```json
{
  "env": {
    "IWENCAI_API_KEY": "sk-proj-..."
  },
  "channels": {
    "feishu": {
      "enabled": false,
      "appId": "",
      "appSecret": "",
      "verificationToken": "",
      "encryptKey": ""
    }
  },
  "channelApiKey": "",
  "cron": {
    "financeBreakfast": {
      "enabled": false,
      "schedule": "30 8 * * 1-5"
    },
    "memoryConsolidation": {
      "enabled": true,
      "schedule": "0 23 * * *"
    }
  }
}
```
