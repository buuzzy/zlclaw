# Sage — TODO & Feature Roadmap

> 记录已完成、进行中和待实现的功能。  
> 每个功能标注优先级（P0~P3）和状态。

---

## 已完成 ✅

### HTUIKit 新增 5 个可视化组件
**状态：** ✅ 完成（2026-04-20）

在 Robinhood 风格基础上实现 5 个高密度金融可视化组件：

| 组件 | Artifact 类型 | 说明 |
|------|-------------|------|
| StockSnapshot | `stock-snapshot` | 个股快照：大字价格 + SVG sparkline + 估值三表 + 分析师评级 |
| SectorHeatmap | `sector-heatmap` | 板块热力图：ECharts Treemap，颜色=涨跌幅，面积=成交额 |
| ResearchConsensus | `research-consensus` | 研报评级汇总：评级横条 + 目标价区间 + 研报列表 |
| FinancialHealth | `financial-health` | 财务健康仪表盘：4 维度 2×2 网格 + 分数条 + 摘要 |
| NewsFeed | `news-feed` | 情绪新闻流：Timeline 竖线 + 情绪圆点 + 关联股票涨跌 |

**相关文件：**
- `src/shared/types/artifact.ts` — 追加 5 个新类型
- `src/components/htui/[Name]/[Name].tsx` + `[Name].css` — 各组件实现
- `src/components/htui/ArtifactRenderer.tsx` — 注册 5 个新组件
- `~/.sage/AGENTS.md` — 更新意图路由表 + 组件 Schema 文档

---

### 反馈/Bug 上报系统
**状态：** ✅ 完成

- 悬浮反馈按钮（FeedbackButton）
- 每次反馈附带唯一 ID，便于追踪和定位
- 上报表单含问题分类、描述文本框

---

### P3.2 — Agent Cron Tool（自然语言创建定时任务）
**状态：** ✅ 完成

让 Agent 可以通过自然语言创建/查看/管理定时 Job。

**实现方式：** 不修改 SDK 代码，而是新增一个 `定时任务管理` Skill，Agent 通过 `Skill` 工具调用，按 SKILL.md 的指引用 `Bash` + `curl` 调用本地 cron REST API。

**功能：**
- 创建周期性任务（cron 表达式 / 固定间隔）
- 创建一次性任务（at + deleteAfterRun）
- 价格监控任务（every + 条件检查 prompt + channel delivery）
- 列出、启用/禁用、删除、手动触发任务
- 完整的 prompt 编写指南（自包含、可使用内置金融技能）

**实现文件：**
- `~/.sage/skills/定时任务管理/SKILL.md` — 技能指令文件，Agent 自动发现并注册
- `~/.sage/AGENTS.md` — 意图识别表添加两行路由规则

**自动注册流程：** 服务启动时 `registerFilesystemSkills()` 扫描 `~/.sage/skills/` → 发现 `定时任务管理` → 注册到 SDK skill registry → Agent 的 `Skill` 工具可调用。

---

### Cron → Channel 推送（pushToChannel 真实实现）
**状态：** ✅ 完成

将 `scheduler.ts` 中的 `pushToChannel()` stub 替换为真实的渠道推送逻辑。

**功能：**
- `CronJob` / `AddJobInput` 新增 `targetConversationId?: string` 字段
- `pushToChannel()` 通过 `getChannelManager().getAdapter('feishu')` 找到飞书适配器，调用 `adapter.send()`
- 内置 3 次重试，指数退避（1s / 2s / 4s）；无 targetConversationId 时打印警告并跳过
- 创建 Job 时通过 `addJob()` 的 `targetConversationId` 字段传入目标会话 ID

**实现文件：**
- `src-api/src/shared/cron/types.ts` — 新增 `targetConversationId` 字段
- `src-api/src/shared/cron/scheduler.ts` — `pushToChannel()` 真实实现 + `AddJobInput` / `addJob()` 透传字段

---

### Cron Scheduler 状态误报修复
**状态：** ✅ 完成

**问题：** `sys-memory-consolidation` Job 在 consolidator 内部报告 `result.failed[]` 非空时，scheduler 仍将 run 状态记录为 `'success'`，导致设置面板误显示「成功」。

**修复：** 在 `executeJob()` 的 sys-memory 分支中，检查 `result.failed.length > 0`：
```typescript
run.status = result.failed.length > 0 ? 'failed' : 'success';
if (result.failed.length > 0) {
  run.error = `Consolidation failed for: ${result.failed.join(', ')}`;
}
```

**实现文件：**
- `src-api/src/shared/cron/scheduler.ts` — `executeJob()` sys-memory 分支状态逻辑

---

### 飞书 API 速率限制处理（指数退避）
**状态：** ✅ 完成

**问题：** 飞书 Open API 对高频调用返回 HTTP 429，原代码直接失败，无重试逻辑。

**方案：** 新增 `fetchWithRateLimit()` 工具函数（模块级，无需实例化），替换所有关键 `fetch()` 调用：
- 检测 HTTP 429 响应
- 优先读取 `Retry-After` 响应头（秒数），否则指数退避（1s → 2s → 4s）
- 最多重试 3 次，超过后返回原始 429 响应交调用方处理
- 覆盖范围：`sendViaSDKCard`、`sendViaREST`、`sendStreamingCard`、`updateStreamingCard`、`closeStreamingCard`、`getTenantAccessToken`

**实现文件：**
- `src-api/src/extensions/channel/feishu.ts` — `fetchWithRateLimit()` + 替换关键 `fetch()` 调用

---

### 记忆系统监控面板（Settings > Memory）
**状态：** ✅ 完成

在设置面板新增「记忆系统」分类，展示向量索引状态仪表盘。

**功能：**
- 4 格状态网格：索引状态 / Chunk 总数 / Embedding 模型 / 最后索引时间
- 已索引来源文件列表（区分 MEMORY.md、日文件）
- Embedding 配置摘要（provider / base URL / API key 脱敏）
- 操作按钮：「重建向量索引」（`POST /memory/index`）、「立即归纳记忆」（`POST /memory/consolidate`）
- 索引进行中时每 2 秒轮询状态

---

### Cron 任务 UI — Jitter 配置（Settings > Cron）
**状态：** ✅ 完成

在「新建定时任务」对话框中增加执行抖动（Jitter）配置，避免所有任务整点堆积。

**功能：**
- 仅对非一次性任务（`scheduleType !== 'at'`）显示
- Toggle 开关（默认开启）+ 秒数输入框（0–3600，默认 30 秒）
- POST 创建时携带 `jitter` 字段（毫秒），关闭时传 0

---

### 本地安全中间件（localOnlyMiddleware）
**状态：** ✅ 完成

所有管理类路由（`/memory/*`、`/cron/*`、`/settings/*` 等）受 TCP 级别回环检测保护，拒绝来自非 127.x / ::1 的请求。

**实现文件：**
- `src-api/src/shared/middleware/local-only.ts` — 使用 `@hono/node-server/conninfo` 获取客户端 IP
- `src-api/src/app/index.ts` — 注册中间件至管理路由组

---

### 记忆写入与注入验证
**状态：** ✅ 已验证

- **写入**：每轮非 trivial 对话追加至 `~/.sage/memory/YYYY-MM-DD.md`（截断：用户 ≤200 字符，助手 ≤300 字符）
- **注入**：新对话开始时调用混合搜索（vector 0.7 + keyword 0.3），将 top-5 结果注入 system prompt
- **实测**：查询「westock数据接口 skill 技能封装」，返回今日日文件得分 0.42–0.60，注入正常

---

### 记忆分层保留策略（三层架构）
**状态：** ✅ 完成

解决长期记忆膨胀问题，同时保证「数字分身」不遗忘重要信息。

**三层设计：**

| 层级 | 内容 | 索引状态 | 保留策略 |
|------|------|---------|---------|
| 热层（0–30天）| 原始日文件 chunk | 完整索引 | 磁盘保留，30天后从索引毕业 |
| 温层（归纳后）| consolidator 提炼摘要 → MEMORY.md | 永久索引，权重 ×1.3 | 永不删除 |
| 画像层 | user.md 用户档案 | 永久索引，权重 ×1.2 | 永不删除 |

**关键逻辑：**
1. `indexer.ts` 新增 `HOT_LAYER_DAYS = 30`：`discoverMemoryFiles()` 只发现 ≤30 天的日文件；`evictExpiredDailyChunks()` 在 `indexIfNeeded` 时清扫过期 chunk
2. `search.ts` 新增 `sourceWeight()`：MEMORY.md ×1.3，user.md ×1.2，日文件 ×1.0，确保长期记忆优先召回
3. `consolidator.ts` 归纳成功后立即调用 `removeBySource()` 将对应日文件 chunk 从索引移除（内容已升华入 MEMORY.md）

---

### F25 — 每日记忆归纳
**状态：** ✅ 完成（含架构升级）

每晚 23:00 将 `~/.sage/memory/YYYY-MM-DD.md` 中的日常对话提炼为结构化长期记忆，追加到 `~/.sage/MEMORY.md`。

**实现文件：**
- `src-api/src/shared/memory/consolidator.ts` — 核心逻辑（扫描、LLM摘要、写入标记文件、触发向量重索引）
- `src-api/src/app/api/memory.ts` — `POST /memory/consolidate` 手动触发端点
- 通过 Cron 调度器自动注册为系统 Job（id: `sys-memory-consolidation`，每天 23:00）

**幂等性保障：**  
每个处理过的日期文件写入 `.YYYY-MM-DD.consolidated` 标记文件，崩溃重启后不会重复处理。

---

### Cron 调度系统（F24 基础设施）
**状态：** ✅ 完成

#### 架构概览

```
用户（设置面板 / Agent 自然语言）
    ↓
REST API  POST /cron/jobs
    ↓
CronScheduler (shared/cron/scheduler.ts)
    ├── 持久化 → ~/.sage/cron/jobs.json
    ├── node-cron（type=cron）
    ├── setInterval（type=every）
    └── setTimeout（type=at，一次性任务）
         ↓
    isolated Agent run（runAgent with empty history）
         ↓
    job.runs 历史记录（最多保留 10 条）
         ↓（可选）channel delivery
```

#### 实现文件
| 文件 | 说明 |
|------|------|
| `src-api/src/shared/cron/types.ts` | 类型定义：CronJob, CronSchedule, CronRun |
| `src-api/src/shared/cron/store.ts` | 持久化层，原子写入（tmp+rename），内存缓存 |
| `src-api/src/shared/cron/scheduler.ts` | 调度引擎，生命周期管理，isolated Agent 执行 |
| `src-api/src/app/api/cron.ts` | REST API（CRUD + 手动触发） |

#### REST API 端点
```
GET    /cron/jobs           列出所有 job
POST   /cron/jobs           创建 job
GET    /cron/jobs/:id       查询单个 job
PUT    /cron/jobs/:id       更新 job（支持 enabled 切换）
DELETE /cron/jobs/:id       删除 job（system job 不可删除）
POST   /cron/jobs/:id/run   手动立即执行
```

#### 内置系统 Job（不可删除，可禁用）
| ID | 名称 | 触发时间 |
|----|------|---------|
| `sys-memory-consolidation` | 每日记忆归纳 (F25) | 每天 23:00 |

---

### Consolidator baseUrl `#` Bug 修复
**状态：** ✅ 完成

**问题：** `config.json` 中 `baseUrl` 末尾带有 `#`，用于 Agent SDK 内部路由。但 consolidator 使用原生 `fetch()` 直接拼接路径时，Node.js 将 `#` 后内容视为 URL fragment 静默丢弃，导致 LLM 请求发往错误路径，归纳失败。

**修复：** 在 `callLLM()` 中对 baseUrl 做清洗：
```typescript
const baseUrl = rawBaseUrl.replace(/#.*$/, '').replace(/\/$/, '');
```

---

### 夜间记忆归纳验证（consolidator 端到端测试）
**状态：** ✅ 完成（2026-04-18 手动验证）

验证了完整的 consolidator 流程：
- ✅ 手动触发 `POST /memory/consolidate`（Settings > Memory > 立即归纳记忆）
- ✅ LLM 成功提炼 `2026-04-16.md` → 写入 `MEMORY.md`（`## 2026-04-16 每日归纳` 四节结构）
- ✅ `.2026-04-16.consolidated` 标记文件已生成，幂等保护正常
- ✅ MEMORY.md 触发向量重索引
- ✅ jobs.json 输出：`Processed: 2026-04-16, Skipped: 0, Failed: none`

---

## 进行中 🚧

（暂无）

---

## 待实现 📋

### P0 — 品牌更名：HTclaw → Sage

**状态：** 待实现（2026-04-20）

#### 品牌决策背景

当前内部代号 **HTclaw**（"HT" 源于项目早期命名，"claw" 隐喻抓取数据）是开发代号，不适合面向用户的正式产品。

经评估，正式产品名定为 **Sage**：
- 英文本义"智者/先哲"，传达洞见、沉稳、可信赖
- 与产品核心差异化高度契合：**有记忆的个人 AI 金融助手**，像一位了解你的私人顾问
- 简洁（单音节），国际化友好，域名/AppStore 搜索辨识度高
- Tagline 方向：*"Your personal financial Sage"* / *「懂你的 AI 投资顾问」*

#### 需要更名的范围

**代码层**

| 位置 | 当前值 | 目标值 |
|------|--------|--------|
| `src-tauri/tauri.conf.json` → `productName` | `HTclaw` | `Sage` |
| `src-tauri/tauri.conf.json` → `identifier` | `com.htclaw.app` | `com.sage.app`（或 `ai.sage.app`） |
| `package.json` → `name` | `htclaw-app` | `sage` |
| `src-api/package.json` → `name` | `htclaw-api` | `sage-api` |
| App 标题栏、窗口标题 | HTclaw | Sage |
| 设置面板、About 页 | HTclaw | Sage |

**数据目录**

| 位置 | 当前值 | 目标值 | 注意 |
|------|--------|--------|------|
| `getAppDir()` 返回路径 | `~/.sage/` | `~/.sage/` | 需要迁移脚本，兼容旧数据 |
| `getClaudeSkillsDir()` | `~/.claude/skills/` | 保持不变（通用） | — |
| Cron 持久化目录 | `~/.sage/cron/` | `~/.sage/cron/` | 随 appDir 自动迁移 |
| 向量索引目录 | `~/.sage/memory-index/` | `~/.sage/memory-index/` | 随 appDir 自动迁移 |

**GitHub 仓库**

| 项目 | 当前 | 目标 |
|------|------|------|
| 仓库名 | `buuzzy/HTclaw` | `buuzzy/sage`（或保留 HTclaw 作为开发仓库） |

**文档 & 注释**

- `docs/` 下所有 `.md` 文件中的 "HTclaw" 字样替换为 "Sage"
- 代码注释中的 `[HTClaw]`、`[HT Claw]` 前缀统一替换
- `SOUL.md`、`AGENTS.md` 模板中的品牌提及更新

#### 数据目录迁移方案

首次启动检测到 `~/.sage/` 存在而 `~/.sage/` 不存在时，自动执行迁移：

```
1. cp -r ~/.sage/ ~/.sage/        # 拷贝全量数据
2. 写入 ~/.sage/.migrated_from_htclaw  # 标记文件，防止重复迁移
3. 提示用户：旧数据已迁移，~/.sage/ 可手动删除
```

迁移逻辑加在 `src-api/src/config/constants.ts` 的 `getAppDir()` 或 Tauri 启动钩子中。

#### 实现建议

先做"软更名"（UI 展示层），再做"硬更名"（目录迁移）：

```
阶段一：UI 层更名（低风险，随时可回滚）
  → tauri.conf.json productName / 窗口标题 / 设置面板 / About 页

阶段二：标识符更名
  → bundle identifier / package.json name

阶段三：数据目录迁移（最后做，风险最高）
  → getAppDir() 路径变更 + 迁移脚本 + 兼容测试
```

---

### P1 — OKX 全链路交易集成

**状态：** 💡 构思中（2026-04-19）

#### 背景

HTclaw 当前已覆盖 A 股的行情获取与投研分析。但 A 股存在一个根本限制：**券商 API 不对个人开放**，AI 完成分析后用户仍需手动到券商 App 执行交易，链路断裂。

OKX 开放了完整的 REST + WebSocket API（免申请，API Key 即可使用），覆盖现货、合约、期权全品类，支持行情查询、账户管理、下单交易。这使 HTclaw 有机会在加密资产方向实现**从行情 → 分析 → 下单的完整闭环**。

#### 整体链路

```
行情数据        投研分析        信号生成        风控确认        下单执行        持仓监控
────────       ────────       ────────       ────────       ────────       ────────
OKX 实时       AI 解读        AI 建议         用户点击        OKX API        实时追踪
行情/K线        宏观+链上       入场点位         确认卡片        trade/order    持仓盈亏
资金费率        情绪指标        仓位比例         金额展示        批量撤单        止盈止损
深度/成交       技术形态        止损设置         不可绕过        异步回调        异常告警
```

#### 分阶段实现计划

**第一阶段：`okx-market` Skill — 行情与数据（只读，无账户）**

新增 `src-api/resources/skills/okx-market/SKILL.md`，封装以下 OKX Public API（无需 API Key）：

| 接口 | 说明 |
|------|------|
| `GET /api/v5/market/ticker` | 单币种实时报价（最新价、24h 涨跌、成交量） |
| `GET /api/v5/market/tickers` | 全市场行情概览 |
| `GET /api/v5/market/candles` | K 线数据（1m/5m/1H/4H/1D 等 13 种粒度） |
| `GET /api/v5/market/books` | 盘口深度 |
| `GET /api/v5/market/trades` | 最近成交记录 |
| `GET /api/v5/rubik/stat/taker-volume` | 主动买/卖成交量比 |
| `GET /api/v5/rubik/stat/contracts/long-short-account-ratio` | 多空持仓人数比 |
| `GET /api/v5/public/funding-rate` | 当前资金费率 |
| `GET /api/v5/public/open-interest` | 持仓量 |

**第二阶段：`okx-account` Skill — 账户与持仓（只读，需 API Key）**

| 接口 | 说明 |
|------|------|
| `GET /api/v5/account/balance` | 账户余额 |
| `GET /api/v5/account/positions` | 当前持仓 |
| `GET /api/v5/trade/orders-pending` | 当前挂单列表 |
| `GET /api/v5/trade/fills` | 历史成交记录 |
| `GET /api/v5/account/bills` | 账单流水 |

**第三阶段：`okx-trade` Skill — 下单执行（需 trade 权限 API Key）**

核心原则：**AI 只负责计算和提案，执行权始终在用户手中。**

交互流程：
```
用户：把我 20% 的 USDT 在当前价附近买入 BTC

AI 分析后输出 artifact:trade-confirm 确认卡片
  ┌─────────────────────────────────────────┐
  │  📋 待确认订单                           │
  │  BTC-USDT 现货 · 买入                   │
  │  价格：$84,000   数量：0.0238 BTC       │
  │  金额：≈ 2,000 USDT（占余额 20%）       │
  │  [✅ 确认下单]        [❌ 取消]          │
  └─────────────────────────────────────────┘

用户点击"确认下单" → 调用 POST /api/v5/trade/order
```

风控配置（`config.json`）：
```json
{
  "okx": {
    "trade": {
      "enabled": true,
      "allowedInstTypes": ["SPOT"],
      "maxSingleOrderUSDT": 1000,
      "maxDailyTradeUSDT": 5000,
      "requireConfirmation": true
    }
  }
}
```

#### 实现顺序建议

```
okx-market (public, 无风险) → 验证数据质量和用户场景
    ↓
okx-account (read-only) → 让 AI 能结合真实持仓做分析
    ↓
trade confirm UI (artifact:trade-confirm) → 前端确认组件
    ↓
okx-trade (模拟盘验证) → 全流程端到端测试
    ↓
okx-trade (真实环境，小额测试) → 上线
```

---

### P1.5 — 用户引导（Onboarding）与 user.md 自动生成

**状态：** 待实现

#### 背景

HTclaw 内置三层记忆系统（`user.md` 用户画像 + `MEMORY.md` 长期记忆 + 日文件），对话自动记录和夜间归纳均**无需 embedding 开箱即用**。但有一个缺口：`user.md` 目前没有任何自动生成逻辑，需要用户自行创建并填写，导致「让 HTClaw 更懂用户」这件事在初次使用时无法自动启动。

**Embedding 与记忆的关系澄清（设计决策背景）：**
- **无 embedding**：`loadMemoryFullText()` 全量注入 `user.md` + `MEMORY.md` + 近两日日记，「懂用户」基础功能完全可用
- **有 embedding**：额外支持语义检索，仅在 MEMORY.md 累积超过 60 条每日归纳（约 2 个月使用量）后才有明显收益
- 结论：embedding 是锦上添花，不是 user.md 的前置依赖

#### 目标

首次启动时，通过对话引导用户回答几个问题，Agent 自动生成并写入 `~/.sage/user.md`，使记忆系统立即「有料可用」。

#### 方案设计

**触发时机：** 检测到 `~/.sage/user.md` 不存在时（或文件为空），在 UI 层展示 onboarding 引导卡片。

**引导内容（5 个问题，1 分钟内完成）：**
1. 你的名字或昵称？（让 AI 以合适称呼回应）
2. 主要关注哪个市场？（A股 / 港股 / 美股 / 加密货币）
3. 投资风格大致是？（短线交易 / 中长线投资 / 量化研究 / 学习为主）
4. 最关注哪类标的？（大盘蓝筹 / 成长股 / ETF / 行业板块 / 个股自选）
5. 希望 AI 的沟通风格？（简洁直接 / 详细分析 / 带数据图表）

**自动写入格式（示例）：**
```markdown
# 用户画像

- **昵称**：小明
- **关注市场**：A股为主，偶尔关注港股
- **投资风格**：中长线价值投资
- **关注标的类型**：消费、科技板块，偏好行业龙头
- **偏好沟通方式**：简洁直接，数据支撑

> 首次生成于 2026-04-20，可在 ~/.sage/user.md 手动编辑
```

#### 实现思路

**方案 A（推荐）：UI 引导卡片 + Agent 写入**
- 前端检测 `GET /memory/user-profile-exists`（或直接读 settings）
- 若不存在，显示 onboarding 欢迎界面（覆盖主聊天区域）
- 用户填写表单后，前端 `POST /memory/init-user-profile`，后端格式化写入 `user.md`

**方案 B（轻量）：第一条消息触发**
- 用户发第一条消息时，Agent system prompt 中注入引导指令
- Agent 在回复中主动询问用户信息，收集后调用 `write_file` Tool 写入 `user.md`
- 优点：无需新增 UI；缺点：体验不够主动

#### 相关文件（待创建/修改）
- `src/components/onboarding/OnboardingWizard.tsx` — 引导界面
- `src-api/src/app/api/memory.ts` — 新增 `POST /memory/init-user-profile` 端点
- `src/App.tsx` 或 `src/components/setup-guard.tsx` — 引导触发逻辑

---

### P1.6 — 系统预设 Cron 任务：盘前/盘后简报

**状态：** 待实现（2026-04-20，来源：竞品分析 Stockie）

#### 背景

Stockie（腾讯玩虾）默认开启两个定时简报任务，使用户开箱即能感受到 AI 的价值。Sage 已有完整的 Cron 基础设施（`scheduler.ts` + `sys-market-*` 系统 Job 扩展点），**几乎零成本**即可实现类似体验。

#### 新增系统 Job

| ID | 名称 | 默认时间 | 默认状态 | Prompt 方向 |
|----|------|---------|---------|------------|
| `sys-premarket-brief` | 盘前简报 | 每个工作日 08:45 | **启用** | 今日重点财经日历、昨日美股收盘、期货开盘情况、主要板块预期 |
| `sys-postmarket-brief` | 盘后简报 | 每个工作日 16:30 | **启用** | 今日 A 股收盘总结、主力资金流向、异动个股、明日关注点 |

#### 实现要点

- 在 `scheduler.ts` 的系统 Job 初始化列表追加两条（类似 `sys-memory-consolidation`）
- Prompt 内嵌对应金融技能调用指令（盘前 Skill + 盘后 Skill）
- 工作日过滤：cron 表达式 `45 8 * * 1-5` / `30 16 * * 1-5`
- 用户可在设置面板「定时任务」中禁用，但不可删除
- 输出通过已有 `pushToChannel()` 推送到飞书（如已配置）

#### 相关文件

- `src-api/src/shared/cron/scheduler.ts` — 追加两条系统 Job
- `~/.sage/AGENTS.md` — 盘前/盘后 Prompt 模板示例

---

### P1.7 — 动画化启动引导页

**状态：** 待实现（2026-04-20，来源：竞品分析 Stockie）

#### 背景

Stockie 的首次启动是一个 5 步序列动画，把"等待初始化"变成有仪式感的产品体验。Sage 当前的 `setup-guard.tsx` 是静态检查页，缺乏品牌感。

#### 设计方案

5 步序列，每步持续约 0.8s，配合淡入/滑动动画：

```
1. 启动 Sage 引擎           — 检查 API 连接、config.json
2. 加载金融技能库           — 扫描 ~/.sage/skills/ 注册 Skills
3. 读取你的投资偏好         — 加载 user.md（有则读取，无则标记待引导）
4. 初始化记忆系统           — 加载向量索引 / daily memory
5. 准备就绪 ✦              — 进入主界面
```

每步有小号副标题说明（如"已加载 12 个技能"、"发现 3 天的记忆"）。

#### 实现要点

- 组件：`src/components/onboarding/StartupLoader.tsx` + `StartupLoader.css`
- 在 Tauri `main.tsx` 或 App 初始化流程中替换当前静态 setup-guard
- 实际后台工作与动画并行执行（不纯粹是假进度），每步有真实 API 调用
- 若初始化失败（API 无法连接），在对应步骤展示错误态并停止

---

### P1.8 — 「Sage 秘籍」场景化教程

**状态：** 待实现（2026-04-20，来源：竞品分析 Stockie）

#### 背景

Stockie 内置「玩虾秘籍」：5 个精选使用场景，每个提供完整 Prompt 示例，用户点击直接发送。这解决了新用户"不知道能问什么"的核心痛点。

#### 方案

在主界面空聊天状态（无对话时）展示「Sage 秘籍」卡片网格，每张卡片点击后自动填充 Prompt 到输入框并发送。

**初始 6 个场景（可扩展）：**

| 场景 | 示例 Prompt |
|------|------------|
| 个股全面分析 | "帮我全面分析宁德时代，包括行情、估值和研报评级" |
| 板块热力图 | "今天各行业板块涨跌怎么样，用热力图展示" |
| 财务健康检查 | "帮我做一份贵州茅台的财务健康仪表盘" |
| 市场情绪资讯 | "最近 AI 芯片板块有什么重要新闻，带情绪分析" |
| 设置价格提醒 | "帮我设置一个 BTC 跌破 80000 美元就提醒我的任务" |
| 盘后复盘 | "今天 A 股市场怎么样，帮我做个收盘总结" |

#### 相关文件

- `src/components/chat/EmptyState.tsx`（或新建）— 空状态页面含秘籍卡片
- 卡片数据可硬编码或读取 `~/.sage/scenarios.json`（支持用户自定义）

---

### P1.9 — 用户档案页（Settings > 我的 Sage）

**状态：** 待实现（2026-04-20，来源：竞品分析 Stockie + P1.5 Onboarding）

#### 背景

Stockie 有专门的「我的龙虾」设置页，展示用户偏好摘要和关联账户。Sage 的 `user.md` 目前只是后端文件，缺少对应的 UI 展示和编辑能力，导致 P1.5 Onboarding 完成后用户无法回看和修改已填写的信息。

#### 功能

- 展示 `user.md` 解析后的内容（昵称、关注市场、投资风格等）
- 允许编辑各字段（提交后后端覆写 `user.md`）
- 展示记忆统计：已归纳天数、MEMORY.md 条数、最后归纳时间
- 快捷入口：「重新引导」（清空 user.md 重走 onboarding）、「导出记忆」

#### 相关文件

- `src/components/settings/UserProfilePage.tsx` — 新建
- `src-api/src/app/api/memory.ts` — 新增 `GET /memory/user-profile`、`PUT /memory/user-profile` 端点

---

### P2 — 自选股/关注列表

**状态：** 待实现

- `~/.sage/watchlist.json` 持久化存储
- 「我的自选怎么样」批量查询，并行调用行情技能
- 设置面板支持增删改查自选股

---

### P2.5 — 视觉/图片分析能力

**状态：** 待实现（2026-04-20，来源：竞品分析 Stockie）

#### 背景

Stockie 支持截图分析：用户截取券商 App 持仓截图，AI 通过 OCR 识别持仓内容并给出分析建议。Claude API 原生支持图片输入（`image/png`、`image/jpeg` base64 或 URL），实现成本低。

#### 方案

- 输入框支持粘贴/拖拽图片（Tauri 文件 drop 或剪贴板读取）
- 图片 base64 编码后作为 `image` content block 随消息发送给 Claude
- `AGENTS.md` 追加视觉分析场景路由（持仓截图 → 持仓分析、K线截图 → 形态识别）

#### 典型场景

- 粘贴券商 App 持仓截图 → AI 识别持仓并分析
- 上传财报表格截图 → AI 解读关键数据
- 截取 K 线图 → AI 分析技术形态

#### 相关文件

- `src/components/chat/MessageInput.tsx` — 支持图片拖拽/粘贴
- `src-api/src/shared/agent/runner.ts` — 消息构建支持 image content block

---

### P3 — Hook/Plugin 系统

**状态：** 待实现

- 允许外部扩展（审计日志、内容过滤、自动标签等）
- 基于中间件机制，不破坏现有技能体系

---

## 技术债 🔧

### TD-01 — fin-copilot「结论先行」模板未全面落地

**来源**：stockit `fin-copilot` 扩展的 12 个场景 Prompt 模板

**问题**：
- 现有 `SOUL.md` / `AGENTS.md` 中的财务分析场景未严格遵循「2句结论 + 1句行动建议 + 细节」结构
- LLM 在股票分析场景下仍会先给大段背景铺垫，用户体验不如 Robinhood/fin-copilot

**优化方向**：
- 在 `AGENTS.md` 针对股票/财务/研报分析场景追加 Prompt 约束：「第一段必须是结论和评级，第二段才允许展开数据」
- 禁止在财务分析场景输出 Markdown 大表格（改用卡片组件 `financial-health`、`research-consensus`）
- 使用 ↑↓→ 符号替代文字描述趋势

---

### TD-02 — westock-tool 筛选语法文档缺失

**来源**：stockit `westock-tool` 扩展的 `TOOL.md`

**问题**：
- `intersect([cond1, cond2])` 为 AND 语法，**不支持** `&`/`&&`/`AND`
- `union([cond1, cond2])` 为 OR 语法
- 现有 `AGENTS.md` 中股票筛选路由规则未明确标注这一限制，LLM 容易生成错误语法

**优化方向**：
- 在 `AGENTS.md` 的选股场景路由中追加 **Filter 语法约束块**，并给出正确/错误示例
- 考虑在 `SOUL.md` 全局规则中写入「筛选条件必须用 `intersect([])`，禁止 AND/&&」

---

### TD-03 — 市值单位不一致（A股 vs 港股/美股）

**来源**：stockit `westock-tool` TOOL.md 的 Schema 注释

**问题**：
- A 股 `TotalMV` 单位为**元**，港股/美股 `TotalMV` 单位为**亿元**
- 混用时 LLM 直接拿数值比较会产生数量级错误（如「市值大于 1000 亿」在 A 股应填 `100000000000`，港股填 `1000`）

**优化方向**：
- `AGENTS.md` 中为选股场景补充单位换算说明
- 前端 `StockSnapshot`、`FinancialHealth` 等组件的市值显示统一用 `formatAmount()` 自动换算亿/万亿

---

### TD-04 — 每日记忆截断限制过短

**来源**：stockit `self-improving-agent` 的记忆写入逻辑

**问题**：
- 日记忆条目 summary 截断为 200 字符，长期记忆 200 字符——在复杂交易场景下信息丢失严重
- 当前 `~/.sage/memory/YYYY-MM-DD.md` 写入无字数限制，但 `consolidator` 合并时可能截断

**优化方向**：
- 评估是否将截断阈值提升至 400–600 字符
- 对「用户持仓变更」「重要决策」等高价值条目标记 `priority: high`，合并时不截断

---

### TD-05 — consolidator LLM 超时设置偏低

**来源**：stockit `self-improving-agent` consolidator 逻辑

**问题**：
- 合并大量学习条目时单次 LLM 调用可能超 60s，导致记忆合并静默失败
- 失败时无降级策略（保留原始条目 vs 丢弃）

**优化方向**：
- 超时配置提升至 120s，或拆分批次合并
- 失败时写入 `.learnings/ERRORS.md` 并保留原条目，下次重试

---

### TD-06 — 自改进 Agent 模式尚未引入

**来源**：stockit `self-improving-agent` 扩展完整架构

**问题**：
- HTclaw 目前无错误/学习日志记录机制
- Agent 运行失败的原因（工具调用错误、LLM幻觉、用户纠正）无法积累

**优化方向**：
- 在 `src-api` 引入轻量 learning-logger：捕获工具调用异常 → 写入 `~/.sage/.learnings/ERRORS.md`
- 用户发送「纠正」类消息时（含「不对」「你搞错了」「应该是」等）自动触发 learning entry 写入
- 定期（每周一）consolidator 将 ERRORS + LEARNINGS 中的通用规则提升到 `SOUL.md`/`AGENTS.md`

---

### TD-07 — market-pulse 盘前/盘后 Prompt 模板缺失

**来源**：stockit `market-pulse` 扩展 + `openclaw-plugin-yuanbao` 定时推送模式

**问题**：
- HTclaw 的 P1.6「预设 Cron」计划中只列了时间点，未设计盘前/盘后的具体 Prompt 内容
- 盘前应关注：隔夜美股、期货、大宗商品、重要新闻；盘后应关注：主力资金流向、龙虎榜、北向资金

**优化方向**：
- 在 P1.6 实现时参照 market-pulse 的 `focusAreas` 配置：
  - 盘前 08:45：`"隔夜美股收盘、期货开盘、今日重点事件，给出今日操作预判"`
  - 盘后 16:30：`"今日 A股 收盘总结：主力资金、北向资金、涨跌停统计、明日预判"`
- 结合 `news-feed` 组件输出市场情绪流

---

### TD-08 — Canvas/WebView 交互输出能力缺失

**来源**：stockit `canvas/index.html` + `openclaw-plugin-yuanbao` WebSocket bridge

**问题**：
- HTclaw 所有输出均为静态 artifact 卡片，无法承载交互操作（点击板块 → 下钻明细、拖拽调仓等）
- 移动端 iOS Bridge (`window.webkit.messageHandlers.openclawCanvasA2UIAction`) 已有规范但未实现

**优化方向**：
- 长期：评估引入 Canvas artifact 类型（`type: 'canvas'`），data 为 HTML + JS 字符串，在 WebView/iframe 中渲染
- 短期：`sector-heatmap` 组件添加点击事件，点击板块 → 触发新消息查询该板块成分股

---

### TD-09 — 主动推送（Proactive Push）能力缺失

**来源**：stockit `openclaw-plugin-wzq-channel` `sendText` + `openclaw-qqbot` 主动推送

**问题**：
- 当前 HTclaw 为纯问答模式，无法在价格预警触发、重要新闻发布时主动通知用户
- Cron 任务执行后结果只写入日志，不推送到 UI

**优化方向**：
- 在 Cron 任务完成后，通过 WebSocket/SSE 将结果推送到前端消息流（不需要用户刷新）
- 长期：支持价格预警（用户设置「茅台跌破 1500 提醒我」）→ 后台轮询 → 触发推送

---

### TD-10 — 渠道扩展架构评估

**来源**：stockit 完整渠道扩展生态（wzq/yuanbao/ddingtalk/qqbot/weixin/adp）

**问题**：
- HTclaw 当前仅有桌面 UI 一个输入渠道
- 用户出行时无法通过移动 App / 微信 / 钉钉 访问

**优化方向（P3+ 长期规划）**：
- **P3.1** 微信个人号渠道：基于 weixin 扩展模式（QR 扫码登录 + AES 媒体解密）
- **P3.2** 钉钉企业机器人：Stream Mode，无需公网 IP，适合内部团队使用
- **P3.3** QQ Bot v2：STT 语音转文字输入 + TTS 语音播报结果
- 所有渠道共享同一 Agent 运行时，通过 `sessionKey` 隔离上下文

---

### TD-11 — 技能（Skill）文件结构规范未文档化

**来源**：stockit `skill-creator` 扩展的 Skill 目录规范

**问题**：
- HTclaw 自定义技能（`~/.sage/skills/`）目录存在但格式约定未写入开发文档
- 新技能缺少 `SKILL.md` → `name`/`description` frontmatter → 导致意图匹配失败

**优化方向**：
- 在 `docs/` 新增 `SKILL_AUTHORING.md`，记录：
  - 必填：`SKILL.md`（含 `name`, `description` frontmatter）
  - 可选：`scripts/`（执行脚本）、`references/`（RAG 文档）、`assets/`（静态资源）
  - 命名规范：简短、动词开头、英文（`analyze-portfolio`、`screen-stocks`）
  - **「简洁是关键」**：description ≤ 50 字，避免过度描述导致误触发

---

### TD-13 — Logo / App Icon 细化与最终交付

**来源**：2026-04-20 品牌设计阶段

**现状**：
- SVG 四角星（冰蓝色）已完成，存放于 `src/assets/sage-logo.svg` 及桌面备份
- Nano Banana 生成了 Void 风格 + Frosted 风格两张 16:9 展示图
- App Icon（1:1）版本存在白色描边 + 蓝色光晕过重问题

**待处理**：
- [ ] App Icon 重新生成：去除白色描边，光晕限 80px、6% 透明度，纯黑背景
- [ ] 导出 Figma 标准尺寸集：1024×1024 / 512×512 / 256×256 / 128×128 / 64×64 / 32×32
- [ ] 用 `iconutil` 或 Tauri 脚本替换 `src-tauri/icons/` 中所有图标文件
- [ ] 评估 SVG 比例微调：垂直花瓣与水平花瓣宽度比是否需要调整（当前 66px : 46px）
- [ ] 准备 App Store / 宣传用封面图（1200×628，带品牌字）

---

### TD-12 — ADP 会话历史 API 未利用

**来源**：stockit `adp-openclaw` 扩展的会话历史读取能力

**问题**：
- HTclaw 本地会话历史存储在 SQLite，但跨设备/跨 Session 的历史无法统一检索
- 用户「上次说的那只股票」类请求在新会话中无法响应

**优化方向**：
- 评估将重要会话摘要写入 `~/.sage/memory/YYYY-MM-DD.md`（已有基础）
- 在向量索引就绪后，历史会话可通过语义搜索检索（已有 `hybridSearch` 能力）
- 短期：在系统 Prompt 中注入最近 3 次会话的摘要（类似 ADP 的 `sessionHistory` 参数）
