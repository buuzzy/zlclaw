# Sage — TODO & Feature Roadmap

> 记录已完成、进行中和待实现的功能。
> 每个功能标注优先级（P0~P3）和状态。
> 最后更新：2026-04-21

---

## 已完成 ✅

### V1.0.0 — 品牌更名 + 首次启动初始化 + 正式发布
**状态：** ✅ 完成（2026-04-21）

#### 品牌更名：HTclaw → Sage
将所有产品标识从 HTclaw 更名为 Sage：
- `package.json` name: `sage`，`src-api/package.json` name: `sage-api`
- `src-tauri/tauri.conf.json` productName: `Sage`，identifier: `com.sage.app`
- 数据目录：`~/.sage/`（含旧版 `~/.htclaw/` 自动迁移）
- UI 全面更新：标题栏、About 页、设置面板、Logo 替换为 Sage SVG
- 构建产物：`Sage_1.0.0_aarch64.dmg`

#### 首次启动初始化（First-Run Init）
安装 DMG 到新机器后，用户只需配置一个 API Key 即可开箱即用：
- `ensureAppDirInitialized()` 在 `index.ts` 最前面运行，幂等安全
- 自动创建 `~/.sage/` 目录树：`skills/`、`sessions/`、`memory/`、`logs/`、`cache/`、`cron/`
- 旧版 `~/.htclaw/` 数据自动迁移（拷贝 + `.migrated` 标记，不删原始数据）
- 内置 defaults 文件自动安装（首次运行后不覆盖用户数据）：`AGENTS.md`、`SOUL.md`、`skills-config.json`
- 骨架文件自动生成：`mcp.json`、`user.md`、`MEMORY.md`

#### 17 个金融技能全量内置
所有技能打包进 app bundle（`src-api/resources/skills/`），新用户无需手动配置：

| 技能 | 说明 |
|------|------|
| 行情数据查询 | A/港/美股实时报价、K线、涨跌榜 |
| 财务数据查询 | 三表、财务指标、同比环比 |
| 基本资料查询 | 公司概况、股本结构、高管 |
| 公司经营数据查询 | 营收拆分、分部信息 |
| 行业数据查询 | 板块指数、龙头排名 |
| 指数数据查询 | 上证/深证/创业板等指数 |
| 基金理财查询 | 基金净值、持仓、评级 |
| 宏观数据查询 | CPI/PMI/GDP 等宏观指标 |
| 公告搜索 | 上市公司公告检索 |
| 新闻搜索 | 财经新闻检索与摘要 |
| 研报搜索 | 券商研报检索与摘要 |
| 定时任务管理 | Agent 自然语言创建/管理 Cron Job |
| web-access | 网页内容获取 |
| westock-market | 市场全局数据 |
| westock-quote | 个股行情 |
| westock-research | 研报分析 |
| westock-screener | 选股器 |

#### build.sh 兼容性修复
修复 `update_tauri_config()` 函数中 `resources` 字段的数组/对象格式兼容问题，
避免 `TypeError: config.bundle.resources.includes is not a function`。

---

### HTUIKit 金融可视化组件库（13 个组件）
**状态：** ✅ 完成（2026-04-20）

| 组件 | Artifact 类型 | 说明 |
|------|-------------|------|
| QuoteCard | `quote-card` | 行情卡片：价格、涨跌幅、关键指标 |
| KLineChart | `kline-chart` | K 线图（TradingView 级，含成交量） |
| BarChart | `bar-chart` | 柱状图 |
| LineChart | `line-chart` | 折线图 |
| DataTable | `data-table` | 数据表格 |
| NewsCard | `news-card` | 新闻卡片 |
| StockSnapshot | `stock-snapshot` | 个股快照：大字价格 + sparkline + 估值三表 |
| SectorHeatmap | `sector-heatmap` | 板块热力图：ECharts Treemap |
| ResearchConsensus | `research-consensus` | 研报评级汇总：评级横条 + 目标价区间 |
| FinancialHealth | `financial-health` | 财务健康仪表盘：4 维度 2×2 网格 |
| NewsFeed | `news-feed` | 情绪新闻流：Timeline + 情绪圆点 |
| FinanceBreakfast | `finance-breakfast` | 财经早餐：AI 日报摘要 |
| AIHotNews | `ai-hot-news` | AI 热点资讯流 |

---

### 多渠道推送系统
**状态：** ✅ 完成

- **飞书**：WebSocket 长连接，支持 Markdown 卡片、流式更新、速率限制指数退避（3次重试）
- **微信（WeClaw）**：个人号/公众号适配，支持文本和富文本消息
- Channel API Key 统一鉴权

---

### 记忆系统
**状态：** ✅ 完成

- **每日写入**：每轮对话追加 `~/.sage/memory/YYYY-MM-DD.md`（截断：用户 ≤200，助手 ≤300 字符）
- **向量检索**：混合搜索（vector 0.7 + keyword 0.3），top-5 注入 system prompt
- **每日归纳**：每晚 23:00 自动 consolidate，提炼至 `MEMORY.md`（LLM 四节结构化摘要）
- **三层保留策略**：热层（0-30天原始日文件）→ 温层（MEMORY.md 归纳）→ 画像层（user.md）
- **设置面板**：可视化索引状态、手动触发重建/归纳

---

### Cron 定时调度系统
**状态：** ✅ 完成

- 支持 cron 表达式、固定间隔（every）、一次性任务（at）
- 持久化至 `~/.sage/cron/jobs.json`，启动自动恢复
- isolated Agent 执行（独立上下文，不污染对话）
- 执行结果（最近10条）记录至 jobs.json
- Channel 推送：通过 `targetConversationId` 将任务结果推送到飞书会话
- Jitter 抖动配置，避免整点任务堆积
- 内置系统 Job：`sys-memory-consolidation`（每天 23:00，不可删除）

---

### 本地安全中间件
**状态：** ✅ 完成

所有管理路由（`/memory/*`、`/cron/*`、`/settings/*`）受 TCP 回环检测保护，
拒绝来自非 127.x/::1 的请求。

---

### 会话持久化
**状态：** ✅ 完成

- 全量消息历史持久化至 `~/.sage/sessions/{sessionId}.json`
- 磁盘内容永不截断，context compaction 只影响 LLM 上下文窗口
- 设置面板支持历史会话管理

---

### Agent 文件系统写入
**状态：** ✅ 确认可用

Agent 具备 Bash 工具，可直接读写用户配置文件：
- `~/.sage/user.md` — 用户档案（偏好、关注标的）
- `~/.sage/AGENTS.md` — 工作流规范
- `~/.sage/SOUL.md` — 角色设定
- `~/.sage/MEMORY.md` — 长期记忆
用户通过自然语言指令即可更新以上文件，Agent 自动完成写入。

---

### MCP 服务器集成
**状态：** ✅ 完成

通过 `~/.sage/mcp.json` 配置，支持加载任意 MCP 服务器，
扩展 Agent 能力（文件操作、数据库、外部 API 等）。

---

### OpenAI 兼容端点
**状态：** ✅ 完成

`POST /v1/chat/completions` — 标准 OpenAI 协议，第三方客户端（如 Bob、PopClip）
可直接接入 Sage Agent 能力。

---

### 反馈/Bug 上报系统
**状态：** ✅ 完成

- 悬浮反馈按钮（FeedbackButton）
- 每次反馈附带唯一 ID，便于追踪定位
- 上报表单含问题分类、描述文本框

---

## 进行中 🚧

（暂无）

---

## 待实现 📋

### P1 — OKX 全链路交易集成

**状态：** 💡 构思中（2026-04-19）

加密资产方向实现从行情 → 分析 → 下单的完整闭环（A 股券商 API 不对个人开放）。

**分阶段计划：**

| 阶段 | Skill | 说明 |
|------|-------|------|
| 第一阶段 | `okx-market` | 行情与数据（只读，无需 API Key） |
| 第二阶段 | `okx-account` | 账户与持仓（只读，需 API Key） |
| 第三阶段 | `okx-trade` | 下单执行（需 trade 权限，含确认卡片 `artifact:trade-confirm`） |

**核心原则**：AI 只负责计算和提案，执行权始终在用户手中（不可绕过确认卡片）。

风控配置（`config.json`）：最大单笔、每日限额、仅允许现货、强制确认。

---

### P2 — 主题与个性化

**状态：** 📋 待实现

- 深色/浅色主题切换
- 字体大小调节
- 聊天气泡自定义（头像、颜色）

---

### P2 — 移动端适配

**状态：** 📋 待实现

当前为桌面端专属布局，考虑通过响应式设计支持 iPad 使用场景。

---

### P3 — 应用内更新

**状态：** 📋 待实现

- Tauri updater 集成
- 版本检测与增量更新
- 更新日志展示

---

### P3 — 知识库（RAG）

**状态：** 📋 待实现

允许用户上传 PDF/文档，构建个人知识库，Agent 可跨文档检索回答。

---
