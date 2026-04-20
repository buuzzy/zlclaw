# HT Claw

> v0.1.5 · 2026-04-20

垂直金融领域桌面 AI Agent。自然语言查行情、看 K 线、读研报、追资讯，带记忆、会定时、多渠道。

---

## 快速启动

### 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 22 | Sidecar 运行时 |
| pnpm | ≥ 10 | corepack 自动管理 |
| Rust | ≥ 1.70 | 仅 Tauri 桌面打包需要，纯 Web 开发可跳过 |

### 开发模式（浏览器）

```bash
cd htclaw-app

# 安装依赖
pnpm install

# 启动 Sidecar（后端）
pnpm dev:api

# 新开终端，启动前端
pnpm dev
```

浏览器打开 `http://localhost:1420`。

### 桌面应用模式（Tauri）

```bash
cd htclaw-app
pnpm tauri:dev    # 同时启动 Sidecar + Tauri 桌面壳
```

需要 Rust 工具链，首次构建约 2-3 分钟。

### 试用

在输入框输入：

- `腾讯今天的行情` → 行情卡片
- `给我看苹果最近一个月的日K线` → K 线图表
- `找几条 AI 相关的资讯` → 新闻列表（情绪流）
- `茅台近三年营收和净利润` → 财务数据表格
- `沪深300最近一年走势` → 折线图
- `帮我看下宁德时代的完整快照，含估值指标` → 个股快照
- `今天各板块涨跌情况，用热力图展示` → 板块热力图
- `比亚迪最近的分析师评级` → 研报评级汇总
- `帮我分析阿里巴巴的财务健康状况` → 财务健康仪表盘
- `搜下 AI 芯片的资讯，带情绪分析` → 情绪新闻流

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│              HT Claw 桌面应用 (Tauri 2 + React 19)  │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │  Chat Panel + HTUIKit 金融可视化组件（13 个）    ││
│  │  QuoteCard / KLineChart / BarChart / LineChart  ││
│  │  DataTable / NewsCard / StockSnapshot           ││
│  │  SectorHeatmap / ResearchConsensus              ││
│  │  FinancialHealth / NewsFeed / ...               ││
│  └─────────────────────────────────────────────────┘│
│                    ↕ HTTP + SSE                      │
└────────────────────┬────────────────────────────────┘
                     │ 127.0.0.1:2026
┌────────────────────┴────────────────────────────────┐
│  Hono HTTP Sidecar (htclaw-api)                     │
│                                                     │
│  ├── @codeany/open-agent-sdk (Agent Runtime)        │
│  ├── SOUL.md / AGENTS.md (人设与工作流)              │
│  ├── 11 个 iwencai 金融技能 (~/.htclaw/skills/)     │
│  ├── 记忆系统 (向量语义检索 + 每日归档 + 自动归纳)   │
│  ├── Cron 定时调度器 (价格预警 / 财经早餐推送)       │
│  ├── Channel 适配器 (微信 WeClaw / 飞书)            │
│  └── OpenAI 兼容端点 (/v1/chat/completions)         │
└─────────────────────────────────────────────────────┘
```

---

## 项目结构

```
HTclaw/
├── htclaw-app/                    # 主应用（monorepo）
│   ├── src/                       # React 前端
│   │   ├── components/htui/       # HTUIKit 金融可视化组件（13 个）
│   │   │   ├── QuoteCard/         #   行情卡片
│   │   │   ├── KLineChart/        #   K 线图表 (TradingView Lightweight Charts)
│   │   │   ├── BarChart/          #   柱状图 (ECharts)
│   │   │   ├── LineChart/         #   折线图 (ECharts)
│   │   │   ├── DataTable/         #   数据表格 (Ant Design Table)
│   │   │   ├── NewsCard/          #   新闻列表
│   │   │   ├── AIHotNews/         #   AI 热闻
│   │   │   ├── FinanceBreakfast/  #   财经早餐
│   │   │   ├── StockSnapshot/     #   个股快照 (sparkline + 估值)
│   │   │   ├── SectorHeatmap/     #   板块热力图 (ECharts Treemap)
│   │   │   ├── ResearchConsensus/ #   研报评级汇总
│   │   │   ├── FinancialHealth/   #   财务健康仪表盘
│   │   │   ├── NewsFeed/          #   情绪新闻流
│   │   │   └── ArtifactRenderer   #   Artifact → 组件映射
│   │   ├── components/shared/     # 共享组件
│   │   │   └── ContextUsageRing/  #   上下文用量环形进度
│   │   ├── components/settings/   # 设置面板（模型/技能/渠道/记忆/Cron/MCP）
│   │   ├── shared/lib/            # artifactParser / format 等工具
│   │   └── shared/types/          # artifact.ts 类型定义
│   ├── src-api/                   # Hono Sidecar 后端
│   │   ├── src/app/api/           # HTTP 路由（agent/completions/skills/memory/cron/...）
│   │   ├── src/core/agent/        # Agent 抽象层
│   │   ├── src/core/channel/      # Channel 适配器框架
│   │   ├── src/shared/memory/     # 记忆向量检索（embedding/chunker/search/consolidator）
│   │   ├── src/shared/skills/     # 技能加载与注册
│   │   └── src/config/            # prompt-loader / 环境配置
│   └── src-tauri/                 # Rust 桌面壳
│       ├── src/main.rs
│       └── tauri.conf.json
│
├── hT-agent-config/               # Agent 人设与工作流配置
│   ├── SOUL.md                    # 金融分析师人设
│   ├── AGENTS.md                  # 工作流规范 + Artifact 协议
│   └── _archived/                 # 已归档的旧配置
│
├── docs/                          # 项目文档
│   ├── PRD.md                     # 产品需求文档
│   ├── SPEC.md                    # 技术规格文档
│   ├── TODO.md                    # 功能待办与路线图
│   ├── HTclaw_完整系统架构指南.md  # 系统架构深度说明
│   ├── HTclaw_前端组件架构分析.md  # 前端组件架构分析
│   ├── HTclaw_后端数据结构分析.md  # 后端数据结构分析
│   ├── iwencai.md                 # 技能安装参考
│   └── westock-data-api.md        # westock 数据 API 参考
│
└── README.md                      # ← 你在这里
```

---

## 核心能力

### 金融数据（11 个 iwencai 技能）

| 技能 | 覆盖范围 |
|------|---------|
| 行情数据查询 | 股票/ETF 实时报价、涨跌幅、成交量、技术指标 |
| 指数数据查询 | 上证/沪深300/创业板/恒生/纳斯达克等 |
| 基本资料查询 | 公司信息、上市日期、所属行业 |
| 财务数据查询 | 营收、利润、资产负债表 |
| 公司经营数据查询 | 经营指标分析 |
| 基金理财查询 | 基金业绩、持仓、评级 |
| 新闻搜索 | 财经新闻、政策动态 |
| 研报搜索 | 券商/机构研报 |
| 公告搜索 | 上市公司公告 |
| 宏观数据查询 | GDP、CPI、PMI 等 |
| 行业数据查询 | 行业分析与排名 |

### 可视化组件（HTUIKit — 13 个）

| 组件 | 用途 | 渲染引擎 |
|------|------|---------|
| QuoteCard | 实时行情卡片 | 原生 React |
| KLineChart | K 线图表 | TradingView Lightweight Charts v5 |
| BarChart | 柱状图（财务对比/行业排名） | ECharts |
| LineChart | 折线图（趋势/收益率） | ECharts |
| DataTable | 数据表格（财报/研报/公告） | Ant Design Table |
| NewsCard | 新闻列表 | 原生 React |
| AIHotNews | AI 热闻列表 | 原生 React |
| FinanceBreakfast | 财经早餐卡片 | 原生 React |
| StockSnapshot | 个股快照（sparkline + 估值） | 原生 React + SVG |
| SectorHeatmap | 板块热力图 | ECharts Treemap |
| ResearchConsensus | 研报评级汇总 | 原生 React |
| FinancialHealth | 财务健康仪表盘 | 原生 React |
| NewsFeed | 情绪新闻流 | 原生 React |

### 多渠道接入

| 渠道 | 状态 | 说明 |
|------|------|------|
| 桌面端 | ✅ 可用 | Tauri 桌面应用 + Web 模式 |
| 微信 (WeClaw) | ✅ 可用 | OpenAI 兼容端点对接 |
| 飞书 | ✅ 代码就绪 | 需飞书开放平台部署配置 |

### 记忆系统

- **长期记忆**：`~/.htclaw/MEMORY.md`（投资偏好、关注标的）
- **用户画像**：`~/.htclaw/user.md`
- **每日归档**：`~/.htclaw/memory/YYYY-MM-DD.md`（每次回复后自动追加）
- **自动归纳**：每日 23:00 提炼对话要点，写入长期记忆
- **语义检索**：向量 Embedding + BM25 混合搜索，按查询相关性注入上下文
- **三层保留**：热层（0–30天原始）→ 温层（归纳摘要，永久）→ 画像层（user.md，永久）

### Cron 定时调度

- Agent 可创建、查看、删除定时任务
- 内置：每日财经早餐推送（可开关）
- 支持价格预警、周期性数据推送
- 任务持久化于 `~/.htclaw/cron-jobs.json`
- 支持 Jitter 配置，防止整点堆积

---

## 生产构建

```bash
cd htclaw-app

# macOS ARM
pnpm build:app:mac-arm

# macOS Intel
pnpm build:app:mac-intel

# Windows
pnpm build:app:windows

# Linux
pnpm build:app:linux
```

产物位于 `htclaw-app/src-tauri/target/release/bundle/`。

---

## 运行时数据目录

```
~/.htclaw/
├── config.json          # 环境配置（API Key、渠道配置）
├── skills-config.json   # 技能启用/禁用
├── SOUL.md              # Agent 人设（运行时副本）
├── AGENTS.md            # 工作流规范（运行时副本）
├── user.md              # 用户画像
├── MEMORY.md            # 长期记忆
├── cron-jobs.json       # 定时任务配置
├── dedup-cache.json     # 消息去重缓存（跨重启持久化）
├── skills/              # iwencai 技能包
├── memory/              # 每日对话归档
├── memory-index/        # 向量索引
├── sessions/            # 会话数据
└── logs/                # 日志
```

---

## 常见问题

**Sidecar 未启动？**
→ 确认 `pnpm dev:api` 在运行，默认端口 `2026`

**pnpm 版本不匹配？**
→ `corepack enable && corepack prepare`

**首次 Tauri 构建很慢？**
→ Rust 依赖首次编译约 2-3 分钟，后续增量构建很快

**技能不可用？**
→ 检查 `~/.htclaw/skills/` 目录是否有技能包，以及 `~/.htclaw/config.json` 中 API Key 是否配置

**飞书消息有延迟或重复？**
→ 已内置 5s 消息补偿、持久化去重、速率限制，一般无需手动处理

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Tauri 2 (Rust + WebView) |
| 前端 | React 19 + TypeScript 5 + Vite 7 + Tailwind CSS 4 |
| UI 库 | Ant Design 6 + Radix UI |
| 图表 | TradingView Lightweight Charts v5 + ECharts 6 |
| 后端 | Hono (Node.js ≥ 22) |
| Agent | @codeany/open-agent-sdk |
| 数据 | iwencai Open API（同花顺问财） |

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 产品需求文档 |
| [docs/SPEC.md](docs/SPEC.md) | 技术规格文档 |
| [docs/TODO.md](docs/TODO.md) | 功能待办与路线图 |
| [docs/HTclaw_完整系统架构指南.md](docs/HTclaw_完整系统架构指南.md) | 系统架构深度说明 |
| [docs/iwencai.md](docs/iwencai.md) | iwencai 技能安装参考 |
