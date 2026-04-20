# HTclaw — TODO & Feature Roadmap

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
- `~/.htclaw/AGENTS.md` — 更新意图路由表 + 组件 Schema 文档

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
- `~/.htclaw/skills/定时任务管理/SKILL.md` — 技能指令文件，Agent 自动发现并注册
- `~/.htclaw/AGENTS.md` — 意图识别表添加两行路由规则

**自动注册流程：** 服务启动时 `registerFilesystemSkills()` 扫描 `~/.htclaw/skills/` → 发现 `定时任务管理` → 注册到 SDK skill registry → Agent 的 `Skill` 工具可调用。

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

- **写入**：每轮非 trivial 对话追加至 `~/.htclaw/memory/YYYY-MM-DD.md`（截断：用户 ≤200 字符，助手 ≤300 字符）
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

每晚 23:00 将 `~/.htclaw/memory/YYYY-MM-DD.md` 中的日常对话提炼为结构化长期记忆，追加到 `~/.htclaw/MEMORY.md`。

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
    ├── 持久化 → ~/.htclaw/cron/jobs.json
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

### P2 — 自选股/关注列表

**状态：** 待实现

- `~/.htclaw/watchlist.json` 持久化存储
- 「我的自选怎么样」批量查询，并行调用行情技能
- 设置面板支持增删改查自选股

---

### P3 — Hook/Plugin 系统

**状态：** 待实现

- 允许外部扩展（审计日志、内容过滤、自动标签等）
- 基于中间件机制，不破坏现有技能体系

---

## 技术债 🔧

（暂无）
