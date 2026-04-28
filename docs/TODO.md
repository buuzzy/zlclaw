# Sage — TODO & Feature Roadmap

> 记录已完成、进行中和待实现的功能。
> 每个功能标注优先级（P0~P3）和状态。
> 最后更新：2026-04-27（v1.0.31 发版 + iOS 方案规划）

---

## 已完成 ✅

### V1.0.3 — 多平台 CI 发布 + 包体瘦身
**状态：** ✅ 已发版（2026-04-25）

#### 新增：macOS Intel 平台支持（CI 驱动构建）
- 新建 `.github/workflows/release.yml`：tag 触发的 GitHub Actions 三平台 matrix（首发实际产出 mac-arm + mac-intel；Windows 因 WiX 中文路径 bug 暂缓）
- 新建 `scripts/gen-latest-json.sh`：替代旧的手写 heredoc，多平台 latest.json 自动生成
- macOS Intel runner 用 `macos-15-intel`（旧 `macos-13` 已 2025/12/4 下线）
- rc tag（如 `v1.0.3-rc1`）自动识别为 prerelease 且不生成 latest.json，OTA 指针不被污染

#### 优化：移除内置 Claude/Codex CLI sidecar
- `tauri.conf.json` 删除 `externalBin` 里 `claude` + `codex` 和 `resources` 里 `cli-bundle`
- 包体瘦身约 150MB（v1.0.2 ARM DMG ~200MB → v1.0.3 ~36MB）
- 前端原本就有 `installClaude` / `installCodex` 提示用户 `npm install -g`，零破坏
- CLI 改为后续以插件下载形式按需启用（v1.1+ 规划）

#### 决策留痕（详见 docs/RELEASE.md）
- Windows x64 暂缓发版：CI 实测 WiX `light.exe` 对中文产品名"涨乐金融龙虾"有 encoding bug，NSIS 已成功但 `bundle.targets:"all"` 强带 MSI 导致整个 job 失败。`docs/RELEASE.md` 附录 E 记录恢复模板（`bundles_flag: "--bundles nsis"`）
- Windows 首发不做代码签名，未来恢复时 release notes 走 SmartScreen 解除（附录 B 模板已备好）

---

### V1.0.2 — MiniMax 模型兼容性修复 + 分时图组件
**状态：** ✅ 已发版（2026-04-23）

#### 修复：MiniMax 模型 planning 阶段 bug（P1）
**Release:** https://github.com/buuzzy/zlclaw/releases/tag/v1.0.2
**详见**：下方 "P1 — MiniMax tool-use 协议泄漏 + artifact 类型误选" 已关闭条目

两处修复集中在 `src-api/src/extensions/agent/codeany/index.ts:plan()`（commit `9d77ebf`）：
- planning 阶段漏剥 `<think>` —— MiniMax / DeepSeek-R1 思考链泄漏到 UI
- parser 失败时重复 yield —— 产生 "block N = block 1+2+…N-1" 全量合并消息

OTA 链路（tauri-plugin-updater + GitHub releases latest.json）首次跨版本实战验证通过。

#### 新增：IntradayChart 分时图组件（commit `436939d`）
A 股日内分时图，artifact 类型 `intraday-chart`，匹配 TradingView 视觉风格：
- 双 grid 布局（上价格、下成交量），axisPointer.link 十字线同步
- 242 tick FULL_AXIS（09:30-11:30 + 13:00-15:00），午间停盘灰化
- prevClose 参考线、成交量按价格相对昨收着色（绿涨红跌，A 股风格）
- HTML formatter tooltip 显示时间/价格/均价/成交量/成交额
- 作为 KLineChart "HH:MM 格式数据" 白屏 bug（v1.0.1 已防御）的正面解决方案

---

### V1.0.1 — 首轮内测修复 + 品牌更名
**状态：** ✅ 已发版（2026-04-23）
**Release:** https://github.com/buuzzy/zlclaw/releases/tag/v1.0.1

详见下方 M1 / M2 / M3 / M4a 验收段落；核心交付：
- M1 本地数据按 uid 隔离（`~/.Sage/users/{uid}/`），旧数据自动迁移
- M2 app 内"检查更新"按钮 + OTA 链路就绪
- M3 sidebar / 设置 / "关于" 三级红点更新提示
- M4a Supabase 环境变量分离（dev / prod）
- 同步状态 UI 重构（macOS 原生头像小圆点 + mask）
- 首轮回归修复：title `<think>` 污染、StockSnapshot 白屏
- 品牌再命名：Sage → Sage

---

### V1.0.0 — 品牌更名 + 首次启动初始化 + 正式发布
**状态：** ✅ 完成（2026-04-21）

#### 品牌更名：HTclaw → Sage
将所有产品标识从 HTclaw 更名为 Sage：
- `package.json` name: `Sage`，`src-api/package.json` name: `Sage-api`
- `src-tauri/tauri.conf.json` productName: `Sage`，identifier: `com.Sage.app`
- 数据目录：`~/.Sage/`（含旧版 `~/.htclaw/` 自动迁移）
- UI 全面更新：标题栏、About 页、设置面板、Logo 替换为 Sage SVG
- 构建产物：`Sage_1.0.0_aarch64.dmg`

#### 首次启动初始化（First-Run Init）
安装 DMG 到新机器后，用户只需配置一个 API Key 即可开箱即用：
- `ensureAppDirInitialized()` 在 `index.ts` 最前面运行，幂等安全
- 自动创建 `~/.Sage/` 目录树：`skills/`、`sessions/`、`memory/`、`logs/`、`cache/`、`cron/`
- 旧版 `~/.htclaw/` 数据自动迁移（拷贝 + `.migrated` 标记，不删原始数据）
- 内置 defaults 文件自动安装（首次运行后不覆盖用户数据）：`AGENTS.md`、`SOUL.md`、`skills-config.json`
- 骨架文件自动生成：`mcp.json`、`user.md`、`MEMORY.md`

#### 17 个金融技能全量内置
所有技能打包进 app bundle（`src-api/resources/skills/`），新用户无需手动配置：

| 技能 | 说明 | 类型 |
|------|------|------|
| 行情数据查询 | A/港/美股实时报价、K线、涨跌榜 | iwencai |
| 财务数据查询 | 三表、财务指标、同比环比 | iwencai |
| 基本资料查询 | 公司概况、股本结构、高管 | iwencai |
| 公司经营数据查询 | 营收拆分、分部信息 | iwencai |
| 行业数据查询 | 板块指数、龙头排名 | iwencai |
| 指数数据查询 | 上证/深证/创业板等指数 | iwencai |
| 基金理财查询 | 基金净值、持仓、评级 | iwencai |
| 宏观数据查询 | CPI/PMI/GDP 等宏观指标 | iwencai |
| 公告搜索 | 上市公司公告检索 | iwencai |
| 新闻搜索 | 财经新闻检索与摘要 | iwencai |
| 研报搜索 | 券商研报检索与摘要 | iwencai |
| 定时任务管理 | Agent 自然语言创建/管理 Cron Job | iwencai |
| web-access | 网页内容获取 | 其他 |
| westock-market | 市场全局数据 | westock |
| westock-quote | 个股行情 | westock |
| westock-research | 研报分析 | westock |
| westock-screener | 选股器 | westock |

**合计：12 个 iwencai + 4 个 westock + 1 个 web-access = 17 个**

#### 模型测试连接兼容性修复
修复「测试连接」对 MiniMax 等非极速版模型始终失败的问题。
根因：detect 端点使用 `stream: false` 发送探活请求，但 MiniMax 非极速版模型不接受非流式请求（返回 HTTP 529）。
实际对话走 Agent SDK 的流式路径（`stream: true`）所以正常。
修复方案：detect 统一改为 `stream: true`，HTTP 200 即判定连接有效，不解析响应体。
同时改进错误分支：用 `response.text()` 替代 `response.json()` 读取失败响应，兼容流式/非 JSON 错误格式。

#### build.sh 兼容性修复
修复 `update_tauri_config()` 函数中 `resources` 字段的数组/对象格式兼容问题，
避免 `TypeError: config.bundle.resources.includes is not a function`。

---

### HTUIKit 金融可视化组件库（14 个组件）
**状态：** ✅ 完成（2026-04-20，IntradayChart 补齐于 2026-04-23）

| 组件 | Artifact 类型 | 说明 |
|------|-------------|------|
| QuoteCard | `quote-card` | 行情卡片：价格、涨跌幅、关键指标 |
| KLineChart | `kline-chart` | K 线图（TradingView 级，含成交量） |
| IntradayChart | `intraday-chart` | A 股分时图（双 grid、午间停盘灰化、prevClose 参考线、TV 配色） |
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

- **每日写入**：每轮对话追加 `~/.Sage/memory/YYYY-MM-DD.md`（截断：用户 ≤200，助手 ≤300 字符）
- **向量检索**：混合搜索（vector 0.7 + keyword 0.3），top-5 注入 system prompt
- **每日归纳**：每晚 23:00 自动 consolidate，提炼至 `MEMORY.md`（LLM 四节结构化摘要）
- **三层保留策略**：热层（0-30天原始日文件）→ 温层（MEMORY.md 归纳）→ 画像层（user.md）
- **设置面板**：可视化索引状态、手动触发重建/归纳

---

### Cron 定时调度系统
**状态：** ✅ 完成

- 支持 cron 表达式、固定间隔（every）、一次性任务（at）
- 持久化至 `~/.Sage/cron/jobs.json`，启动自动恢复
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

- 全量消息历史持久化至 `~/.Sage/sessions/{sessionId}.json`
- 磁盘内容永不截断，context compaction 只影响 LLM 上下文窗口
- 设置面板支持历史会话管理

---

### Agent 文件系统写入
**状态：** ✅ 确认可用

Agent 具备 Bash 工具，可直接读写用户配置文件：
- `~/.Sage/user.md` — 用户档案（偏好、关注标的）
- `~/.Sage/AGENTS.md` — 工作流规范
- `~/.Sage/SOUL.md` — 角色设定
- `~/.Sage/MEMORY.md` — 长期记忆
用户通过自然语言指令即可更新以上文件，Agent 自动完成写入。

---

### MCP 服务器集成
**状态：** ✅ 完成

通过 `~/.Sage/mcp.json` 配置，支持加载任意 MCP 服务器，
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

### P1 — MiniMax 不采信 SKILL.md 的 artifact 选择规则（v1.0.4 候选）

**发现于**：v1.0.3-rc1 验收（2026-04-25）

**现象**：用户问"宁德时代今天上午的分时"或类似当日分时请求，agent 输出 *"分时数据拿到了。系统目前没有分时图专用组件"*，而非走 `intraday-chart` artifact 渲染图表。

**已排除的不是根因**：
- ✅ `src/components/htui/IntradayChart/IntradayChart.tsx` 存在（commit `436939d`）
- ✅ `src/shared/types/artifact.ts:4` 含 `'intraday-chart'`、`src/components/htui/ArtifactRenderer.tsx:51-53` 已注册路由
- ✅ `src-api/resources/skills/westock-quote/SKILL.md:228` + `:254` 明确写 "分时 → `artifact:intraday-chart`"
- ✅ `~/.sage/skills/westock-quote/SKILL.md` mtime 是新版本（v1.0.3 启动时 `installBuiltinSkills` 已同步过去）
- ✅ `sage.log` 显示 v1.0.3-rc1 测试时 prompt length 13714 chars，足以装下 SKILL.md

**真正根因**：MiniMax-M2.7-highspeed 模型不严格遵循 system prompt 里的 artifact 选择规则。这跟 v1.0.2 修过的 `<think>` 泄漏 + duplicate `direct_answer` 是 **同源 LLM 行为问题**，但更深一层（不是协议解析 bug，是模型 reasoning 跳过 SKILL.md 检索）。

**v1.0.4 候选修复方向**（按落地难度排序）：
1. **将关键 artifact 类型表从 SKILL.md 提到 system prompt 顶层**（`src-api/src/shared/services/agent.ts` 的 `buildSystemPrompt`），不让模型在长 prompt 中"忘记"它
2. **加 few-shot 例子**：分时请求 → 调 `/minute/query` → 输出 `<artifact type="intraday-chart">{...}</artifact>` 的完整示范
3. **加 artifact-type 后置 guard**：拿到分时数据后，agent.ts 检查模型是否选了 intraday-chart，未选则强制 wrap
4. **换模型/试 GLM/Kimi 看遵循度**（成本最高）

**优先级**：P1（影响首屏体验，但有 K 线兜底，不阻塞 v1.0.3 内测）。

---

### P3 — 恢复 Windows x64 发布

**发现于**：v1.0.3-rc1 CI（2026-04-25）

**现象**：CI Windows job 在 `Tauri build` 步骤失败：
```
Running light to produce ...bundle\msi\涨乐金融龙虾_1.0.3_x64_en-US.msi
failed to bundle project `failed to run ...WixTools314\light.exe`
```

**根因**：`tauri.conf.json:bundle.targets="all"` 在 Windows 上等于 `nsis + msi` 都打。WiX 3.14 的 `light.exe`（2014 年的 .NET 3.5 老工具）对产品名含中文字符（"涨乐金融龙虾"）的 MSI 文件名有 encoding bug。**NSIS 本身已成功**（`.exe` 安装包 + `.nsis.zip` updater + `.sig` 都生成了），是 MSI 拖累整个 job 失败。

**恢复步骤**（约 15 分钟工作量）：

1. 取消 `.github/workflows/release.yml` matrix 里 Windows job 的 3 行注释
2. 给 Windows job 加 `--bundles nsis` 跳过 MSI（推荐用 matrix 字段 `bundles_flag` 参数化）
3. 模板见 `docs/RELEASE.md` 附录 E（含两种 matrix 写法 + 备选 productName 降级方案）

**优先级**：P3（v1.0.3 已通过 mac-arm + mac-intel 覆盖大部分用户，Windows 用户基数小且可临时下其他工具替代）。

**触发恢复时机**：
- 内测群有 Windows 用户明确反馈需要
- 或下次有空（< 30 分钟），顺手恢复

---

### P2 — iOS 移动端（Demo → 正式）

**状态：** 📋 方案已设计（2026-04-27）
**详细文档：** [`docs/ios/IOS_PLAN.md`](./ios/IOS_PLAN.md)

**架构**：Capacitor 包裹现有 React 前端 + sage-api 部署到 Railway ($5/月)
**不能用 Tauri iOS 的原因**：iOS 禁止 fork/exec，Node.js sidecar 无法运行

**分阶段**：
| Phase | 内容 | 工作量 |
|-------|------|--------|
| Phase 0 | 最小 Demo：sage-api 上 Railway + Capacitor WebView 包裹 + TestFlight | 2-3 天 |
| Phase 1 | iOS UI 适配：底部导航、Safe Area、虚拟键盘、图表触摸 | 3-5 天 |
| Phase 2 | 数据层：SQLite→Supabase、文件系统、Deep Link/OAuth | 3-5 天 |
| Phase 3 | App Store 上架准备 | 1-2 天 |

**前置依赖**：桌面端 v1.0.x 功能基本稳定后启动

---

### P2 — 意图识别驱动的执行策略分层

**状态：** 📋 待设计（2026-04-27）

三层策略：直接执行（简单查询）→ 静默 plan（多步无歧义）→ 显式 plan+确认（有副作用/高成本）。
混合方案：规则层先拦 90%，拦不住的走 LLM 分类。涉及 `useAgent.ts` 路由 + 后端 plan 逻辑。

---

### P1 — 数据源迁移：腾讯金融 API → TinyShare

**状态：** 📋 待启动（2026-04-27，等接口文档 + MCP 到位后开始）

**背景**：当前 4 个 westock-* 技能（quote / market / research / screener）全部依赖腾讯金融代理接口。后续将整体迁移到 TinyShare 数据源。

**涉及范围**：
| 改动项 | 文件/目录 |
|--------|----------|
| SKILL.md（4 个） | `src-api/resources/skills/westock-quote/` `westock-market/` `westock-research/` `westock-screener/` |
| PostToolUse 拦截 | `src-api/src/extensions/agent/codeany/index.ts`（URL_PATH_PATTERNS、ARTIFACT_TYPE_MAP、transformForComponent、generateSummary） |
| 前端 artifact 映射 | `src/shared/config/artifactMapping.ts` |
| API 文档 | `docs/api/westock-data-api.md` → 替换为 TinyShare 文档 |
| MCP 集成 | 待定（TinyShare 提供 MCP server，可能替代当前 Bash curl 调用方式） |

**待用户提供**：
- [ ] TinyShare 接口文档
- [ ] TinyShare MCP server 配置

**迁移策略**：拿到文档后，逐技能替换，保持前端 artifact 组件不变（数据转换层吸收差异）。

---

## 🔥 P0 小范围内测 Roadmap

**目标**：让 5~10 位内测用户能稳定使用 Sage、我们能收到反馈、能持续推送更新。
**时间线**：按下方顺序做，前 4 项必须全部完成才开放内测。

**分支策略备忘**：所有 roadmap 工作都在 `dev` 分支进行，**首轮内测包（v1.0.1）
稳定运行 1 周且无 P0 bug 后**，才把 `dev` 合并到 `main` 并打 `v1.0.1` release tag。
在那之前 `main` 保持 v1.0.0 发布态不动。

---

### 🚧 MUST-HAVE（内测启动前必须完成）

#### M1 — 本地数据按账号隔离（P0）

**状态：** ✅ 已完成（2026-04-22）

**问题：** 当前本地 SQLite (`~/Library/Application Support/ai.Sage.desktop/Sage.db`) 和 session 文件 (`~/.Sage/sessions/*.json`) 没有 user 维度。用户 A 登录后创建会话 → 登出 → 用户 B 登录 → 能看到 A 的全部会话。这是**数据隔离 bug，不是 UX 问题**，内测不能带此问题上线。

**方案：** 用户作用域化数据根目录
```
~/.Sage/
  users/
    {user-uuid}/
      Sage.db
      sessions/*.json
      memory/
      logs/
      cache/
      cron/
  skills/           ← 共享（用户无关）
  defaults/         ← 共享
  mcp.json          ← 共享（MCP 配置和运行环境相关）
```

**实施步骤：**
1. 新建 `src/shared/lib/user-scoped-paths.ts`，根据当前登录 user.id 动态解析出各数据路径
2. `database.ts` 的 `getSQLiteDatabase()` 改为按 user.id 懒加载连接；切换用户时先 close 旧连接
3. session 文件层（`~/.Sage/sessions/*.json` 的读写）全部走用户作用域路径
4. AuthProvider 在 `SIGNED_IN` 事件时触发一次"数据路径切换"
5. **一次性迁移**：首次升级后若发现 `~/.Sage/Sage.db` 存在（历史数据），把它移到当前登录用户的目录。写迁移标记避免重复。
6. **登出时**：不清除本地数据（用户再登录回来要能继续用），只把数据路径置空（切回 login 页）

**实际实现要点（与原计划的差异）：**
- DB 物理位置：`~/.Sage/users/{uid}/Sage.db`（而非原计划里错误的 "~/.Sage/Sage.db"；真实 legacy 位置是 `~/Library/Application Support/ai.Sage.desktop/Sage.db`）
- 利用 Tauri SQL plugin 的 `PathBuf::push` 绝对路径特性绕开 `app_config_dir` 限制
- Rust migrations 只对固定 `sqlite:Sage.db` 生效，所以 schema 由 JS 幂等 `ensureSchema()` 负责
- JWT 解析兜底：断网启动时从 `sb-*-auth-token` 解析 user.id 提前 bind，避免 30s 卡顿
- `dbReady` 信号加入 AuthGuard：避免 cloud session 已 resolve 但本地 DB 还没切完时显示旧账号残影
- 迁移策略：复制而非移动（rollback safety），全局标记 `~/.Sage/.user-scope-migration-v1` 只让第一个登录的用户继承 legacy 数据

**验收：**
- [x] 用户 A 登录创建会话 → 登出 → 用户 B 登录 → 看不到 A 的任何会话（TS/Vite/Rust build 通过，待 dmg 实机验收）
- [x] B 创建会话 → 登出 → A 重新登录 → 看到自己的会话（同上）
- [x] 现有用户升级后数据正常迁移到 `users/{自己的 uid}/`，会话不丢（migration 函数已实现 copy-not-move，待实机验收）
- [x] `~/.Sage/skills/` 和 `~/.Sage/defaults/` 两个用户共用同一份（设计保留，未动这些目录）

**成本：** 实际 ~1 天（含方案调整、circular dep 排查）

---

#### M2 — App 内手动检查 / 下载更新（P0）

**状态：** ✅ 已完成（2026-04-22）

**需求：** 设置 > 关于 > "检查更新"按钮，点击后若有新版则下载、校验签名、安装、重启。

**方案：** `tauri-plugin-updater` 官方插件 + GitHub Releases 托管 manifest

**实施步骤：**
1. Rust 端：添加 `tauri-plugin-updater` + `tauri-plugin-process` 依赖，`capabilities/default.json` 加权限 ✅
2. 生成 updater 的 Ed25519 签名密钥对，公钥写入 `tauri.conf.json`，私钥保管于 `.env.tauri-signing`（gitignored）+ 用户 1Password ✅
3. `tauri.conf.json` 的 `plugins.updater.endpoints` 指向 `https://github.com/buuzzy/zlclaw/releases/latest/download/latest.json` ✅
4. AboutSettings.tsx 添加"检查更新"按钮 + 状态（checking / up-to-date / available / downloading / ready / installing / error）✅
5. 下载完成后走 `downloadAndInstall()` + `relaunch()` ✅
6. 失败场景：网络错误、签名验证失败、磁盘写入失败都显示红色 error 条 ✅

**方案变更：** 启动 banner 改为 "设置 > 关于" 红点提示（参见下方 M3-dropped）

**待人工：**
- 真正发布 v1.0.1 时要跑 `pnpm tauri:build:signed:mac-arm` 打签名包，把 DMG + `.sig` + `latest.json` 传到 GitHub Releases
- `latest.json` 的写法参考 https://tauri.app/plugin/updater/#dynamic-update-server（后续补 `docs/RELEASE.md`）

**验收：**
- [x] 打 v1.0.0 安装 → 发布 v1.0.1 release + manifest → 点"检查更新"能发现 ← 实机验收通过 2026-04-23
- [x] 下载进度可见、签名校验通过、安装成功、自动重启 ← 实机验收通过 2026-04-23
- [x] 签名错误的 manifest 会被拒绝（安全验证）← tauri-plugin-updater 内置 Ed25519 校验逻辑，OTA 流程通过即证明签名链路工作
- [x] 断网时按钮显示"检查失败"而不是卡住

**成本：** 实际 ~0.5 天

---

#### M3 — 启动时自动检查更新 + 内推送 UI（P0）

**状态：** ⛔ 已变更方案（2026-04-22）

**变更原因：** 用户不希望顶部 banner 挤压主内容区。改为设置弹窗"关于" Tab 内部已有的检查更新状态 + 红点提示导航到该 Tab。

**当前实现：**
- `UpdateProvider` 启动后 3s 仍会静默 `check()`（保留，这是红点的数据源）
- sidebar user avatar 右上角红点：`status === 'available' && version !== dismissedVersion && version !== aboutSeenVersion`
- sidebar dropdown menu 里"设置"item 右侧红点：同条件
- 设置弹窗左侧 nav "关于" item 右侧红点：同条件
- 用户打开"关于" Tab → `markAboutSeen()` 同步把 `aboutSeenVersion` 设为当前版本 → sidebar 两处红点消失
- "关于" Tab 的红点持续到用户点"下载更新"或下一个版本号到来

**验收：**
- [x] 启动 Sage 3 秒后，若有新版，sidebar 用户头像右上角红点出现 ← 实机验收通过 2026-04-23
- [x] 打开设置（点 sidebar 头像 → Settings，或直接看到 dropdown 里红点）→ sidebar 红点消失，"关于" Tab 仍保留红点 ← 2026-04-23
- [x] 切到"关于" Tab → "关于" Tab 的红点也消失，按钮显示 `发现新版本 v1.0.1` ← 2026-04-23
- [x] 点击按钮 → 下载 + 安装 + 重启 ← 2026-04-23

**成本：** 实际 ~0.5 天

---

#### M4 — Dev / Prod Supabase 环境分离（P0）

**状态：** ✅ M4a 完成（2026-04-22）；M4b 已取消（2026-04-23 决策）

**问题：** 当前 `SUPABASE_URL` 硬编码到 `supabase.ts`。开发构建和 release 构建用同一个数据库，一旦内测启动，我们本地 debug 任何改动都会影响真实用户数据。

**拆分：**

**M4a — 代码层（✅ 已完成）**
- `src/shared/lib/supabase.ts` 读 `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，未设置时 fallback 到 prod 硬编码值
- `src/vite-env.d.ts` 加上类型声明
- `.env.development` / `.env.production` 模板已建（gitignored）
- AboutSettings 底部显示当前环境标签：`Development · xxxxxxx.supabase.co`
- `scripts/build-signed.sh` 打包前会 source `.env.production`

**M4b — Sage-dev 双 project 方案（⛔ 已取消 2026-04-23）**

**取消原因：**
1. 内测范围小（nakocai 认识的同事），用户数据 schema 在内测期不会有大变动
2. 维护两个 project + 两套 OAuth 配置的成本 > 风险收益
3. dev 模式临时调试时，nakocai 会避免触碰生产数据表（通过手工约定，而非架构隔离）

**保留的资产：**
- M4a 的环境变量读取代码保留不动，`.env.development` 文件也保留 —— 未来若决定开 dev project 或走 L3（Supabase local Docker）可直接启用
- Sage-dev project 本身（`pskweazwczdgtohkdmee`）暂不主动删除，保留作为未来备选

**如果未来要恢复 M4b 的步骤（存档）：**
1. ✅ Supabase dashboard 建 `Sage-dev` project（2026-04-22 已建）
2. schema 同步到 dev project：`supabase link --project-ref <dev-ref>` + `SUPABASE_DB_PASSWORD=... supabase db push`
3. Database > Publications 打开 `profiles` + `user_settings` 的 Realtime
4. Authentication > URL Configuration 加 `Sage://auth/callback` 到 Redirect URLs
5. GitHub OAuth App + Google OAuth Client 分别指向 dev project 的 callback URL
6. 把 dev project 的 URL + anon key 填进 `.env.development`

**验收（M4a）：**
- [x] `pnpm tauri:build:signed:mac-arm` 出的 DMG → AboutSettings 显示 "Production · wymqgwtagpsjuonsclye.supabase.co"（v1.0.1 实机已确认）

**成本：** M4a 实际 ~0.5 小时

---

### 📋 NICE-TO-HAVE（内测启动后第一周补）

#### N1 — 数据导入 / 导出 / 账号注销

拆成三条独立跟踪，避免打包交付。

##### N1a — 数据导出

**状态：** 🟡 基础能用，待补完整（2026-04-23 check）

**现状（`src/components/settings/tabs/DataSettings.tsx:handleExport`）：**
- Tauri 原生 save dialog → 写 `Sage-backup-YYYY-MM-DD.json`
- JSON 结构：`version, exportedAt, sessions[], tasks[], mesSages[], files[], settings`
- M1 隔离后数据自动限定到当前绑定 user（走 user-scoped DB 连接）
- 内测期用户留底会话历史 / 给开发者发 backup 排查问题，够用

**Known issues（后续补齐）：**
- [ ] **不含 session attachment 物理文件**：`files[]` 只是 DB 元信息（filename / task_id / size），真实 attachment 在 `~/.Sage/users/{uid}/sessions/{sid}/attachments/` 目录下。导出 JSON 不等于完整用户状态。建议方案：改为 zip 格式，JSON + attachments/ 目录一起打包。
- [ ] **不含云端数据快照**：error_logs / user_settings 云端副本未导出。内测期排查靠 Supabase dashboard 直接看表，这一条优先级最低。
- [ ] **文件名品牌未更新**：文件名仍是 `Sage-backup-*.json`，考虑是否改为 `htclaw-backup-*.json` —— 但 JSON schema 里 `version` 字段暴露了历史，改名意义不大，暂缓。

**成本：** zip 格式 + attachment 打包 ~0.5 天

##### N1b — 数据导入

**状态：** 🟡 UI 存在但半残，**内测版已禁用**（2026-04-23）

**问题（`handleImport`，L153-155 自带 TODO 注释）：**
```ts
// Note: Full import would require database insert operations
// For now, we just import settings
// TODO: Implement full data import with database operations
```

导入只恢复 `settings`，sessions / tasks / mesSages / files **全部丢弃**，但 UI 仍显示"导入成功"，会骗用户。

**临时处理（已完成 2026-04-23）：**
- 导入按钮 `disabled`，label 改为"即将支持 / Coming soon"
- 描述文案加 "（内测版尚未启用）"/"(disabled in beta)"
- 避免内测用户误操作后发现会话全没了

**正式版补齐方案：** 恢复所有表行到 user-scoped DB，配合 zip 解包恢复 attachments 文件，加导入前 dry-run 预览 + 确认对话框。

**成本：** ~0.5 天

##### N1c — 账号注销

**状态：** 📋 正式版实现

**需求：** 用户在设置 > 账号里能"注销账号"。前置：提示"这将永久删除你的所有云端数据，建议先导出"，附数据导出按钮。

**注销：** edge function 级联删除 profiles + sessions + user_settings + error_logs（RLS 会自动限定 user_id），再清本地用户目录 + signOut。

**内测期策略：** 内测用户都是认识的同事，结束后由 nakocai 在 Supabase dashboard 手动清数据，无需产品内路径。

**成本：** 1 天

#### N2 — 启动加载 UX 优化

**状态：** 📋 待实现

**问题：** 当前 AuthGuard 的"转圈"只有一个 spinner，没有文案。3 秒超时兜底虽已处理，但正常启动 1-2 秒的等待体验也不够好。
**方案：** 加 "正在连接..." / Logo 动画 / 启动阶段提示。另外评估启动时序——能否并行 initializeSettings 和 getSession。

**成本：** 0.5 天

#### N3 — 基础隐私政策与 TOS 占位页

**状态：** 📋 正式版再做（内测跳过）

**决策（2026-04-23）：** 内测用户都是认识的同事，不涉及第三方披露需求，暂不做。登录页底部的"同意服务条款和隐私政策"文字先保持现状（死链但用户不会点）。上正式版时一并补。

**正式版方案：** notion / 简单静态页承载内容 + LoginPage 链接跳出（系统浏览器打开）。

**成本：** 半天（内容撰写占大头，技术是一个 webview 跳转）

---

### 🧊 LATER（等内测反馈再评估）

- ~~同步状态 UI 重构（迁移到头像角标 + 遮罩）~~ ✅ 已完成
- 跨设备看会话列表（只元数据不加载内容）
- 跨设备消息体同步（加密 blob）
- 后台排查面板（内测期直接 Supabase Dashboard 看表即可）
- 多窗口 / 多实例同步验证

---

### ⚡ L1 — 打包体积优化：按需下载 coding 工具

**状态：** 📋 待实现（P2）

**问题：** 当前 Sage.app DMG 约 **270MB**，主要体积来自：
- `Sage-api` sidecar：~60MB（Node 二进制 + 应用代码）
- 内置 `claude` / `codex` 二进制：各 ~30KB（只是 launcher，实际也小）
- **真正的大头是 skills 资源目录**（Python runtime + 依赖）

但绝大多数用户首次启动不会立刻使用所有 skills。这让下载和首次安装体验很慢。

**方案：**
1. **默认包只含必须资源**：Tauri bundle 只保留核心 Sage app + API sidecar + defaults（AGENTS.md、SOUL.md、skills-config.json）
2. **Skills 按需下载**：用户首次需要某个 skill 时，app 提示"该功能需要下载运行环境（~XX MB），是否继续？"，用户点确认后从 CDN 拉取到 `~/.Sage/skills/{skill-name}/`
3. **coding 工具（claude / codex 等外部 CLI）**：同样按需。当前 bundle 里的 launcher 改为"未安装时提示用户 Settings > 工具里下载"
4. **Skills 清单（manifest）**：托管一个 `skills-manifest.json`（体积、依赖、下载 URL、版本），Settings 面板提供勾选 UI

**收益：**
- DMG 体积可降到 **50~80MB**，首次下载从 30 秒缩到 5 秒
- 安装后磁盘占用减少（未使用的 skill 不占空间）
- 更新体积也更小（只传 app 不传 skills）

**实施步骤：**
1. 新建 `src-api/resources-manifest.json` 描述各 skill 的元数据 + 下载地址
2. Tauri bundle 配置移除 `resources/skills/**`、`resources/coding-tools/**`（或改为极简）
3. 前端 Settings 新增"技能 / 工具管理"面板：列表展示可用 skills，勾选即下载
4. API sidecar 增加 skill 不存在时的降级：返回明确的 "skill_not_installed" 错误码，前端提示用户去下载
5. CDN 选型：GitHub Releases（免费、稳定）还是 Supabase Storage（同数据平台）—— 待评估

**验收：**
- [ ] 新 DMG 体积 < 100MB
- [ ] 首次打开 Sage 所有 UI 正常（不依赖 skill）
- [ ] 尝试使用任一 skill → 提示下载
- [ ] 下载进度可见、校验后可用
- [ ] 设置面板可查看已安装 / 可安装 skills，支持删除释放空间

**成本：** 2-3 天（含 CDN 方案选型）

---

### ⚡ L2 — Supabase Level 2 → Level 3 迁移（工程基建）

**状态：** 🟡 内测期主动停留在 L1.5（2026-04-23 决策）

**当前实际架构：** dev 和 prod 共用同一个 Sage project。M4b 双 project 方案已取消（参见 M4 决策），用手工约定 + 小范围内测的方式规避数据污染风险。

**约束（破坏时必须立即处理）：**
- 本地 dev 模式调试时，避免执行破坏性 SQL（`DELETE FROM sessions`、`DROP TABLE` 等）
- 建议测试会话在 prompt 里带标签 `[DEV-TEST]`，以便事后用 `DELETE FROM sessions WHERE preview LIKE '%[DEV-TEST%'` 清理
- 开始做破坏性 schema 改动（ALTER TABLE 删列、DROP 索引等）前，必须先切回 L2 或 L3

**已保留资产（未来启用用）：**
- Sage-dev 项目（ref: `pskweazwczdgtohkdmee`）仍在 Supabase dashboard 存活
- credentials 存于 `.env.development` 注释里
- M4a 代码层环境变量切换能力就绪

**背景：** 原方案是 M4b 走"两 remote project"（Sage + Sage-dev），已取消。未来如果 schema 开始频繁变动 / 多人协作 / 开发团队加入，按下列路线升级：

| Level | 描述 | 问题 |
|-------|------|------|
| **L1.5（当前内测）** | 单一 prod project，手工约定避免污染 | 靠纪律，不靠架构 |
| L1 | 单一 prod project | 本地 debug 污染真实数据 |
| L2 | Sage + Sage-dev 两个 remote project | schema 靠手动同步易漂移；多人协作互相踩；OAuth 要配两套 |
| **L3（目标）** | `supabase start` 本地 Docker + prod remote | schema as code + 每人独立环境 + 免 dev OAuth |
| L4 | + staging 三层 | 有 QA / 付费用户时再上 |
| L5 | Supabase Branching（Pro plan） | 团队 + CI 成熟再上 |
| **L3（目标）** | `supabase start` 本地 Docker + prod remote | schema as code + 每人独立环境 + 免 dev OAuth |
| L4 | + staging 三层 | 有 QA / 付费用户时再上 |
| L5 | Supabase Branching（Pro plan） | 团队 + CI 成熟再上 |

**L2 → L3 的核心改造：**

1. 引入 Supabase CLI：
   ```bash
   brew install supabase/tap/supabase
   cd ~/Documents/Projects/Start/HTclaw/htclaw-app
   supabase init                                      # 标准化 supabase/ 目录
   supabase link --project-ref wymqgwtagpsjuonsclye   # link prod
   supabase db pull                                   # 把 prod schema 拉成 migrations/*.sql
   ```

2. Schema as code：
   - 以后所有表 / RLS / trigger / function 改动都走 `supabase migration new <name>` 生成带时间戳的 SQL 文件
   - 本地 `supabase db reset` 验迁移无误后 `supabase db push` 到 prod

3. 本地 Docker stack 替代 Sage-dev：
   ```bash
   supabase start   # docker-compose 起本地 Postgres + Auth + Realtime + Storage
   ```
   - `.env.development` 改为 `VITE_SUPABASE_URL=http://127.0.0.1:54321`
   - `VITE_SUPABASE_ANON_KEY` 用本地 stack 启动时打印的 anon key
   - 本地用 Email/password 或 magic link 登录即可 debug，不用配 OAuth

4. 退役 Sage-dev project（Free tier 不占配额，留着或删）

**收益：**
- ✅ Schema 有 git history，3 个月后能 bisect 哪天改了什么
- ✅ `supabase db reset` 随时得到干净初态
- ✅ 新加入的开发者 `git clone` + `supabase start` 即有完整环境
- ✅ CI 能跑 `supabase db reset && pytest`（未来）
- ✅ 不用维护 Sage-dev 的 OAuth

**实施步骤（约 2-3 小时）：**
1. 装 CLI + `supabase login`
2. `supabase init`（会在现有 `supabase/` 目录里补结构）
3. `supabase link --project-ref wymqgwtagpsjuonsclye`
4. `supabase db pull` → 验证生成的 `supabase/migrations/*.sql` 能完整重建 schema
5. 验证 Sage-dev 的 schema 可用后，不再需要手工 SQL 备份（早期的 `supabase/dev-bootstrap.sql` 已删，迁移文件是唯一源）
6. `supabase start` 起本地 Docker stack
7. 更新 `.env.development` 指向 localhost
8. 在 README / `docs/ENV.md` 写下本地环境搭建步骤
9. TODO.md 里 M4b（远程 dev OAuth）打死标记"不再做，已迁 L3"

**风险 & 缓解：**
- Docker 安装 + 资源占用：用 OrbStack 比 Docker Desktop 轻
- 本地 OAuth：暂时不在本地跑 OAuth，用 email/password 或 magic link 替代
- 迁移文件漂移：每次改 prod schema 都必须先生成 migration 文件，不允许 Dashboard 直接改表

**触发时机：** 发第一个内测 DMG 之后的第一周。在此之前 L2 足够用。

**成本：** 2-3 小时

---

## 其他 P0 ~ P3 条目

### P0 — 云端数据同步

**状态：** ✅ Phase 1-5 主功能完成，跨设备 Realtime 待第二台设备验收

**文档：** [`Sage_云端同步设计.md`](./Sage_云端同步设计.md)

**背景：** Supabase 已创建 4 张表（`profiles`、`sessions`、`user_settings`、`error_logs`）并启用 RLS，OAuth 流程跑通。前端同步逻辑分阶段落地中。

**分阶段：**

| Phase | 内容 | 状态 | 完成时间 |
|-------|------|------|---------|
| Phase 1 | Profile 统一（sidebar 从 `profiles` 表读写，替代直读 `user_metadata`） | ✅ 完成 | 2026-04-21 |
| Phase 2 | Settings 云备份（主题、语言、enabledSkills 等非敏感偏好） | ✅ 完成 | 2026-04-21 |
| Phase 3 | Session 元数据同步（最小闭环，元数据 only 单向上云） | ✅ 完成 | 2026-04-21 |
| Phase 4 | Error Logs 上报（全局错误 + React Error Boundary + 反馈上云 + 排查上下文） | ✅ 完成 | 2026-04-22 |
| Phase 5 | Sync 状态 UI + Realtime 订阅 | ✅ 完成（单机验收） | 2026-04-22 |

**Phase 1 完成项：**
- 新增 `src/shared/sync/` 模块（`profile-sync.ts` + `profile-provider.tsx`）
- Sidebar + AccountSettings 改为通过 `useDisplayIdentity` / `useProfile` 读写云端 `public.profiles`
- Vite 暴露 `__APP_VERSION__`，登录时自动上报 `app_version` / `platform`
- localStorage 按 `user.id` 缓存 profile，重启/重登时秒显避免闪烁
- 验证通过：修改昵称/头像生效、退出重登保留、跨设备同步、无闪烁
- 清理了"未登录 fallback"死代码（产品设计上必须登录）

**Phase 2 完成项：**
- 新增 `settings-sync.ts`（白名单 + fetch/push/merge/diff 工具）+ `settings-sync-provider.tsx`
- `saveSettings` 新增 `subscribeSettingsSaved` 观察者机制，云同步模块不依赖 React providers
- 登录时 hydrate + debounced 1s push，去重避免无意义写入
- 白名单 16 个字段（主题、语言、AI/Sandbox/Agent 选择、对话上限、能力开关）
- 验证通过：主题/语言/模型选择跨设备同步，API Key 等敏感字段确认不上云

**Phase 3 完成项：**
- 新增 `session-dirty-queue.ts`（零依赖 dirty 队列 kernel）+ `session-sync.ts`（payload 构造 + CRUD）+ `session-sync-provider.tsx`（React 编排）
- `database.ts` 关键出口（createSession / updateSessionTaskCount / createMesSage / updateTask / deleteTask / createFile / deleteFile）插入 markSessionDirty hooks
- 登录后自动 backfill：扫描本地所有 session id 触发一次全量 upsert
- 500ms debounce + 同一 tick 合并，upsert/delete 互斥去重
- preview 语义 = 用户最后一问（user 类型消息最新一条，极端情况回退到 session.prompt）
- 本期最小闭环：只做单向上云，不把云端独有 session merge 到本地（留给将来消息体同步一起做）
- 验证通过：新建/追问/删除会话在 Supabase 实时反映，preview/mesSage_count/has_artifacts 字段语义正确

**Phase 4 完成项：**
- 新增 `error-sync.ts`（reportError + 离线队列 + env 探测）+ `error-boundary.tsx`（React 错误边界）
- main.tsx 挂载 ErrorBoundary + 注册 window.onerror / onunhandledrejection + 启动时 flushErrorQueue
- TaskDetail 反馈提交同步写 Supabase `error_logs`，本地 JSONL 保留做备份
- 反馈排查上下文：`recent_user_mesSages` / `recent_agent_replies` / `ai_config` / `last_system_subtype` / `ui_mesSage_count` 默认携带
- 可选 checkbox "附上完整对话帮助排查"：勾选后 `context.full_transcript` 包含整个 task 的 mesSages，tool_output 截 2000 字避免 JSONB 膨胀
- 验证通过：反馈记录在 Supabase 正确落盘，user_id 匹配；排查信息充分足以定位"用户抱怨"背后的真实工程问题

**Phase 5 完成项：**
- 新增 `sync-status.ts`（全局状态 store + `useSyncStatus()` hook）+ `sync-status-indicator.tsx`（侧栏底部指示器）
- Profile / Settings / Sessions / Error 四条同步链路全部接入状态上报（markSyncing / markOk / markFailed）
- Profile + Settings 订阅 Supabase Realtime，其他设备的变更通过 `postgres_changes` 推送，自动合并到本地
- **底层 sync 函数语义修正**：原本"失败返回 null"改为"失败抛出 Error"，让上层能准确区分"成功但云端无记录" vs "失败"。解决了断网时 markOk 误报的 bug。
- `sync-status` 引入 retry 注册机制 + `retryFailedChannels({force})` + 指数退避（15s → 30s → 60s → 120s），定时 5s 轮询兜底 `window.online` 事件（macOS WKWebView 常不 emit），避免长期断网时反复闪烁同步中→失败
- 失败态指示器可点击触发 force retry
- `AvatarImage` 组件：`<img>` onError 回退 User icon；监听 sync-status failed→ok/syncing 跃迁时 bust URL 参数强制重载（修复断网启动时头像问号残留、网络恢复不自动重载）
- `AuthProvider` 断网启动兜底：3s 超时从 localStorage 读 `sb-*-auth-token` 决定 authenticated，真正 `getSession` 完成后校正。避免 token 临近过期 + 断网时 supabase-js 的 `_refreshAccessToken` 卡 30s 造成的"启动转圈"。
- 单机验收全部通过。跨设备 Realtime 验收项见下方遗留。

**跨设备 Realtime 待验收（缺第二台设备）：**

- [ ] 两台 Mac 同账号登录 Sage
- [ ] 设备 A 改昵称 → 设备 B sidebar 在 1-2 秒内自动更新（无需重启）
- [ ] 设备 A 改头像 → 设备 B 同步
- [ ] 设备 A 切换主题（浅 ↔ 深）→ 设备 B 自动应用
- [ ] 设备 A 切换语言 → 设备 B 自动切换
- [ ] 设备 A 改默认 AI provider / model → 设备 B 设置面板选择同步
- [ ] 多台设备同时改同一字段 → 最后写入者胜（LWW），没有死循环
- [ ] 断网设备恢复网络后自动拉取缺失的变更

---

### P1 — 同步状态 UI 重构：迁移到头像角标 + 遮罩

**状态：** ✅ 已完成（2026-04-25 代码验证）

**实现概述：**
- `src/components/layout/avatar-status-badge.tsx`：新组件，接收 `<AvatarImage>` 作为 children，根据 `useSyncStatus()` 叠加角标/遮罩
- `src/components/layout/left-sidebar.tsx`：展开态（L412）和折叠态（L697）均用 `<AvatarStatusBadge>` 包裹头像
- `sync-status-indicator.tsx`：已删除，全局零引用
- 正常态：左上角 `size-2 bg-emerald-500 ring-2` 绿点
- 同步中：不显示圆点（避免闪烁）
- 失败态：`bg-black/45 backdrop-blur-[1px]` 遮罩 + `WifiOff` icon，点击触发 `retryFailedChannels({ force: true })`，`onPointerDown` 拦截 DropdownMenu
- 重试中：icon 切换为 `Loader2` 旋转动画
- Tooltip：hover 显示状态 + 上次同步时间 + 失败链路详情
- 无障碍：`role="button"` + `aria-label` + `tabIndex` + Enter/Space 键盘支持

**验收点：**
- [x] 正常联网 → 头像左上角绿点，点击正常展开菜单
- [x] 切换主题 / 改昵称等 syncing 瞬间 → 角标不变（保持绿色，不闪烁）
- [x] 断网 → 头像遮罩 + `WifiOff` icon
- [x] 断网态点击头像 → icon 变 Loader 旋转（不打开菜单）
- [x] 恢复网络 → 遮罩淡出，恢复绿点
- [x] 底部不再有同步状态栏
- [x] 头像 hover 显示 tooltip：状态 + 上次同步时间 + 失败时哪条链路
- [x] 折叠态和展开态行为一致

---

**遗留 / 合并到后续阶段：**

- [ ] **mesSage_count 数字偏大**（P2）：当前值约等于用户实际轮次 × 3~4。根因在 `useAgent.ts` 流式输出时同时写入中间态和终态多条 `type: 'text'` 消息，所以本地 `mesSages` 表对同一轮 Agent 回复会有多条记录。cloud payload 忠实聚合这个数。**修复方案**：等一次 `useAgent.ts` 写 DB 逻辑重构，把一轮对话收敛为"1 条 user + 1 条 text"。本期同步任务先不动 Agent 层。
- [ ] **full_transcript 里 text 有 content=null 的条目**（P3）：和上面 mesSage_count 同根——流式 chunk 空消息被落盘。在 `useAgent.ts` 重构时一并清理。
- [ ] **last_system_subtype 永远是 null**（P3）：UI 层 AgentMesSage 在某些路径下丢失了 DB 的 subtype 字段。排查时我们有 full_transcript 就够用，优先级低。
- [ ] **tool_input 没截断上限**（P3）：当前只截断 tool_output 到 2000 字。如果某天有超长 URL 或大 JSON payload 塞给 MCP 会撑大 JSONB。加一行代码即可解决，集中到下次同步模块优化时做。
- [ ] **反馈不带时间戳**（P3）：allMesSages 是 UI state，不带 created_at。多轮对话间隔（秒 / 小时）看不出来。真正需要时可改为从 DB 重读 mesSages 表。
- [ ] **M1 迁移 bug fixes 追记 — Tauri fs scope 隐藏文件问题**（已修 ✅，记录备忘）：首次实机验收 M1 时发现 `~/.Sage/.user-scope-migration-v1` 写不成功，错误 `forbidden path`。根因：Tauri v2 的 fs scope glob `**` **不匹配以 `.` 开头的隐藏文件**（和 bash shopt dotglob 同逻辑）。修复：capabilities/default.json 额外加 `$HOME/.Sage/.*` 规则。未来再往 `.Sage` 下写任何隐藏文件（marker、缓存、配置）都要确认这个规则还在。
- [ ] **M1 迁移 bug fixes 追记 — writeTextFile vs writeFile 权限路径**（已修 ✅，记录备忘）：首次实机发现 `writeTextFile` 有权限问题即使 `fs:allow-write-text-file` 在 capabilities 里。最终改用 `writeFile(..., TextEncoder().encode(payload))`。未来新增代码优先用 `writeFile` 写文本，避免类似坑。
- [ ] **Updater 签名密钥第一版作废**（已弃用 ⛔）：v1 密钥用 `--password ""` 生成，被 tauri build 拒收（"Wrong password"）。v2 用真实密码（`Sage-Updater-48f601110be9bfdd`）重新生成。公钥已更新到 `tauri.conf.json`。**影响**：如果以后需要重新生成密钥，**必须传非空 password**，否则 build 时会签名失败。
- [ ] **dev Sage 与 release Sage 的 Sage:// deep link 冲突**（P3，未修）：dev 模式（`pnpm tauri:dev`）下 OAuth 回调会被 `/Applications/Sage.app`（release 版）拦截，因为 macOS LaunchServices 把 `Sage://` 分配给注册过的 `.app` bundle，不分配给 `target/debug/Sage`。workaround：dev 验收 OAuth 前临时把 release Sage 改名（`mv /Applications/Sage.app /Applications/Sage-backup.app`），验完再 rename 回来。**根治方案**：dev 模式改用不同的 scheme（如 `Sage-dev://`）+ Supabase dev project 的 redirect URL 配套。和 L2→L3 迁移一起做。

**关键原则：**
- Local-first：所有完整数据在本地，云端只同步元数据/偏好
- 不上云：API Key、消息体、MCP 配置等敏感或大体量数据
- LWW 冲突解决 + 离线队列

---

### P1 — MiniMax tool-use 协议泄漏 + artifact 类型误选 ✅

**状态：** ✅ 已修复（2026-04-23 v1.0.2 发版）

**error_log id（原始反馈）:** `564b986b-0944-4c09-8598-01ca9f9094a3`（Supabase public.error_logs）
**验证日志:** `bcd3e5ae-f493-4d26-bcc6-ae5c0ba1af34`（修复后回归测试）

**模型：** MiniMax-M2.7-highspeed（agent_runtime: codeany, sandbox: codex）

**最终根因（比最初怀疑的更浅、更可修）：**

问题不是 MiniMax API 对接错了，也不是 SKILL.md 不清晰 —— 是 `CodeAnyAgent.plan()` 里的两处 bug 交互暴露：

1. **planning 阶段漏剥 `<think>`**：`src-api/src/extensions/agent/codeany/index.ts:543-548` 原代码直接 `yield { type: 'text', content: block.text }`，绕过了 `run()` 用的 `sanitizeText()`。MiniMax / DeepSeek-R1 等推理模型的 `<think>...</think>` 整段泄漏到聊天气泡和 transcript。

2. **parser 失败时重复输出**：`plan()` 里 `parsePlanningResponse` + `parsePlanFromResponse` 都失败的 fallback 分支，把整个 `fullResponse` 当作 `direct_answer` 再 yield 一次。但前面的循环已经流式 yield 过每个 block 了 —— UI 渲染器把 `direct_answer` 当 text 追加 → 产生 "block 4 = block 1+2+3 的全量合并" 重复消息。

Claude / GPT 产出结构化 JSON plan，走 `parsePlanningResponse → plan` 分支，根本不到 fallback；MiniMax 产出自然语言 + artifact block，parser 识别失败 → 命中双重 yield 路径。所以**只有 thinking 模型 + 非结构化输出的组合**会炸，这解释了为什么 Claude/GPT 用着没事。

**修复（commit `9d77ebf`）：**
```ts
// Before
yield { type: 'text', content: block.text };

// After — 走 sanitize，且 fullResponse 保留原文给 parser
const sanitizedText = this.sanitizeText(block.text);
fullResponse += block.text;
if (sanitizedText) yield { type: 'text', content: sanitizedText };

// Fallback 分支不再重复 yield，仅 warn 日志
logger.warn(`Planning produced unstructured response; streamed as text already, skipping duplicate direct_answer fallback.`);
```

**误诊记录（供未来类似问题参考）：**
- 最初以为是 MiniMax 自有 `<minimax:tool_call>` XML 协议泄漏 —— `open-agent-sdk/providers/openai.js` 已有 `parseMinimaxXmlToolCalls` 处理这类，实测根本没触发
- 怀疑过 "API 没传 tools 参数"、"apiType 识别错"、"baseURL 国际/国内站差异" —— 实际都没问题；靠 diagnostic patch（`~/.Sage/logs/minimax-diag.log`）验证了请求 body 正常
- 真正的线索来自 supabase error_log 的 `full_transcript` —— 里面明确显示 4 个 text block 中前 3 是纯 `<think>`、第 4 是全量合并。第一性原理从数据反推代码路径，锁到 `plan()` 而不是 `run()`

**验收（已通过）：**
- [x] 同 prompt "宁德时代今日上午的分时" 用 MiniMax-M2.7 不再有 `<think>` 泄漏（0 次）
- [x] 不再出现重复合并消息
- [x] artifact 正确输出为 `intraday-chart`，前端渲染出分时图

**未做（留作未来 nice-to-have）：**
- `artifactParser.ts` 运行时 `ktype` 白名单 / HH:MM 自动转 intraday-chart —— 目前 MiniMax 能选对类型就没触发必要，留作"万一未来出错时的兜底"
- MiniMax 专用 system prompt 补丁 —— 同上，目前走不到

**最初问题 A 提到的 "WESTOCK_API_KEY 泄漏到 content"**：transcript 里确实出现过（走 Bash 时 shell 展开 env），但那是 sandbox tool 行为而非 agent 输出 —— 已通过"plan 阶段就用 Skill 调用而非 Bash"路径规避。如果后续 Bash 路径再次出现 env 明文，需要单独在 codex sandbox 输出层做 secret-mask。

---


### P2 — 分时图组件（IntradayChart）数据质量问题

**状态：** 📋 待讨论（2026-04-26 记录）

**现象：** 分时图频繁出现数据不全的问题——价格线只渲染了前半段（如 09:30-10:00），后半段和下午时段大面积空白；成交量柱只在零星几个时间点有数据。视觉上图表大部分区域是空的，用户体验差。

**根因链条：**
1. **API 返回数据本身可能不全**：`/minute/query` 接口返回的分时数据点数不稳定，非交易时间无数据，盘中临时请求拿到的只是当时已产生的 tick
2. **MiniMax 生成的数据处理脚本不稳定**：LLM 负责编写解析 `/minute/query` 返回的空格分隔文本（`"0930 1400.00 4423 619220000.00"`）的 Python 脚本，解析逻辑偶尔出错或只处理了部分数据
3. **成交量字段增加了数据体积和解析复杂度**：每个数据点需要 time + price + avgPrice + volume + turnover 五个字段，而分时图核心只需要 time + price

**待讨论方向（三选一）：**

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 轻量化 | 只请求 time + price，移除 volume 相关字段和下方成交量柱图 | 数据量减半，解析更简单，出错概率低 | 丢失成交量信息 |
| B. 删除组件 | 整个 `intraday-chart` artifact 类型下线，分时查询回退到文字描述或 `line-chart` | 彻底消除问题 | 功能退化 |
| C. 后端直出 | 不依赖 LLM 写脚本解析，在后端代码层直接请求 API 并格式化数据，确保数据完整性 | 数据质量有保障 | 需要新增后端接口，改动较大 |

**建议**：先尝试方案 A（轻量化），成本最低。如果数据质量仍不可接受再考虑方案 C。

---

### P2 — Artifact 组件空壳先行渲染问题

**状态：** 📋 待定位（2026-04-26 记录）

**现象：** 用户查询「贵州茅台现在什么价」时，quote-card 组件先以空壳状态出现在页面上（无数据的卡片框架），随后数据填充进来。预期行为应该是组件和数据同时出现，不应有空壳闪烁。

**初步定位方向：**
- artifact block 通过 `processMessage()` 中的 `pendingArtifacts` 队列，在 `tool_result` 消息之后作为 `{ type: 'text' }` yield 给前端
- 前端 `artifactParser` 从 text stream 中检测到 `` `artifact:quote-card` `` 后立即创建组件实例
- **可能的时序问题**：artifact block 的 JSON 数据是分多个 SSE chunk 到达的，parser 可能在收到开头标记时就创建了组件，但完整 JSON 尚未到达，导致组件先以空数据渲染
- 也可能是前端 React 状态更新的批处理时序——组件挂载和数据 props 传入不在同一个渲染周期

**需要确认的文件：**
| 文件 | 关注点 |
|------|--------|
| `src/shared/lib/artifactParser.ts` | 什么时候判定一个 artifact block 完整？是否有"等数据齐了再创建"的机制？ |
| `src/components/htui/ArtifactRenderer.tsx` | 组件渲染时是否有 loading 态 vs 有数据态的区分？ |
| `src/shared/hooks/useAgent.ts` processStream 部分 | SSE chunk 到组件渲染的时序链路 |

**成本：** 定位 0.5 天，修复视定位结果而定

**状态：** 📋 待修复（2026-04-23 记录）

**现象：** 提问让 agent 返回 K 线数据时，整个路由崩溃：
```
Invalid date string=09:30, expected format=yyyy-mm-dd
vendor-charts-E79-pOdO.js:1:87409
```

**根因：** `src/components/htui/KLineChart/KLineChart.tsx` 用的是 `lightweight-charts`（TradingView 出品），它对 `time` 字段的格式有严格要求：

| 支持 | 示例 |
|---|---|
| 日期字符串 | `"2026-04-23"`（必须严格 yyyy-mm-dd）|
| UNIX timestamp（秒）| `1745366400` |
| BusinessDay 对象 | `{ year, month, day }` |

**不支持** `"09:30"` 这种 HH:MM 格式。后端这次返回的是**分时图数据**（日内逐分钟），但 artifact 类型是 `kline-chart` + `ktype: 'day'`，数据格式和组件预期完全不匹配，库直接 throw，冒泡到 react-router 白屏。

跟 StockSnapshot undefined 字段白屏同类问题：**后端脏数据 × 前端零防御 = 整页炸**。

**修复思路（双层）：**

**1. 组件层防御**（短期，0.5 小时）
`KLineChart.tsx` 加 `isValidTime()` 守卫：
```ts
function isValidTime(t: unknown): boolean {
  if (typeof t === 'number' && Number.isFinite(t)) return true;  // UNIX ts
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
  return false;
}
```
在 `candleSeries.setData` 之前 filter：
```ts
const validPoints = data.data.filter((d) => isValidTime(d.time));
if (validPoints.length === 0) {
  // 整个数据集都没合法时间戳 → 显示占位，不 setData
  return <div className="kline-error">数据格式异常，无法渲染 K 线</div>;
}
```
至少保证路由不再白屏，即使渲染失败也给用户提示。

**2. 后端契约层根治**（1 天）
- 排查 `src-api` 里 K 线 / 分时两条数据接口
- 为分时数据（time=HH:MM）新开一个 artifact 类型（比如 `intraday-chart` 或复用 `line-chart`），不要再复用 `kline-chart`
- Agent 在选择 artifact 类型时根据 user prompt 的时间粒度（"今天" / "当天" → 分时；"近一年" / "周线" → K 线）区分
- 或者增强 KLineChart 组件支持两种时间粒度 + 自动识别，配合 `data.ktype` / 新加 `intraday: boolean` 字段

**验收：**
- [ ] 故意触发"今天的分时"、"今天的走势"类提问 → 不再白屏，要么正常渲染要么显示占位
- [ ] 常规 K 线（"近一年日 K"）仍正常
- [ ] 如果走根治方案：分时数据 artifact 类型独立，不再与 `kline-chart` 复用

**成本：** 防御 0.5 小时 + 根治 1 天

---

### P3 — iwencai API key 改为从 env 读取

**状态：** 📋 待实现（2026-04-23 记录）

**现状：** `src-api/src/config/constants.ts:79` 硬编码 `DEFAULT_IWENCAI_API_KEY` —— 上游 WorkAny 留下的"开箱即用"便利默认值。用户告知此 key 是**同花顺官方公网放出的公共 key**，不属于私密泄漏，但最佳实践应改为环境变量读取：

```ts
export const DEFAULT_IWENCAI_API_KEY = process.env.IWENCAI_API_KEY || '';
```

**.env.example 已存在 `IWENCAI_API_KEY=...` 占位符**（L20），框架已就位。

**优先级：** 低。纯工程卫生改进，无实际安全风险，**不影响任何用户使用**（用户现在装 DMG 不需要自带 key，他们会在 Settings 里自己配 AI model key，iwencai 跟他们无关）。

**成本：** 15 分钟（改源码 + README 环境变量说明）

---

### P2 — 导出图片截断（底部黑边）

**状态：** 📋 待修复（2026-04-23 记录）

**现象：** 点击"导出图片"保存出来的 PNG 打开后底部是一片纯黑，对话内容被截断 / 盖住。

**代码位置：** `src/app/pages/TaskDetail.tsx:1726-1773`，`handleExportImage` 用 `html-to-image` 的 `toPng()` 截取 `containerRef`（L928，外层的 `flex overflow-hidden rounded-2xl` 容器）。

**根因分析（~95% 把握）：**
1. **截取的是"可视视口"而不是"完整内容"**：`containerRef` 指向的外层 div 带 `overflow-hidden` + 固定高度（由 flex 父容器决定）。`html-to-image` 只能拍到这个 viewport 内渲染出来的部分，**滚动区下方的消息完全没被渲染进截图**。底部黑边其实是 viewport 的高度被截取出来、但**没有对应内容**那部分（PNG 默认透明 / 或浏览器把透明 fallback 成黑色）。
2. **消息列表是内部独立 `overflow-y-auto` 滚动容器**：即便 `containerRef` 没有 overflow-hidden，内部消息列表自己有滚动条，html-to-image 只拍到滚动区内当前可见的那些消息，不会展开全量内容。
3. **`pixelRatio: 2` 无关**：只放大了 2x，不会让黑边消失。

**可能的补充诱因：**
- 黑色（而非白色 / 透明）通常意味着 `backgroundColor` 配置缺失 + 元素里某个地方有 `background: #000` 或使用了 CSS `color-scheme: dark` 被 html-to-image 错误继承。
- 也可能是**滚动容器内 sticky / absolute 定位元素**（比如 input 底栏 `agent-action-bar`）被错误包含/排除导致几何错乱。我们现在 filter 把 `.agent-action-bar` 排掉了，但可能还有别的元素被它遗留的 spacer 影响。

**修复思路（按推荐顺序）：**

1. **临时 expand 到全量高度再截图**（推荐，工作量小）：
   ```ts
   // 1. 找真正的滚动容器（mesSages scroll div）
   const scrollEl = node.querySelector('[data-mesSages-scroll]') as HTMLElement;
   const originalHeight = scrollEl.style.height;
   const originalOverflow = scrollEl.style.overflow;
   // 2. 临时解开 overflow 让内容全部撑开
   scrollEl.style.height = 'auto';
   scrollEl.style.overflow = 'visible';
   // 3. 在外层 node 上把 height 也撑开
   const originalNodeHeight = node.style.height;
   node.style.height = 'auto';
   try {
     const dataUrl = await toPng(node, {
       pixelRatio: 2,
       backgroundColor: '#ffffff',  // 显式白底防黑边
       // ...
     });
   } finally {
     scrollEl.style.height = originalHeight;
     scrollEl.style.overflow = originalOverflow;
     node.style.height = originalNodeHeight;
   }
   ```
   需要在 mesSages scroll container 上加 `data-mesSages-scroll` 标记供 query。

2. **显式传 `backgroundColor: '#ffffff'`**：哪怕上面方案 1 做不彻底，至少底部黑边会变白边（视觉上不再诡异）。一行改动。

3. **考虑换成 `toJpeg`**：JPEG 不支持透明，html-to-image 会用 backgroundColor fill，比 PNG 更不容易黑。代价是文件稍大，无 alpha。

**验收：**
- [ ] 任一 task 详情页点"导出图片"→ PNG 打开后**没有底部黑边**，能看到全部对话（可以滚动长对话的每一条）
- [ ] 浅色主题和深色主题下，背景色应当合理（浅色主题白底，深色主题深底，不是随机黑色）
- [ ] `agent-action-bar` 仍然被正确排除

**成本：** 0.5 天（含跨主题测试）

**测试点：** 3 轮对话 + 10 轮对话 + 含 artifact 卡片（stock snapshot）的长对话，三种情况都要验。

---

### P2 — 更新按钮展示下载进度（P2 UX）

**状态：** 📋 待实现（2026-04-23 记录）

**背景：** 当前 `AboutSettings` 的"检查更新"按钮在 downloading / ready / installing 三个阶段都是一个 `<Loader2 className="animate-spin">` 无限旋转图标。DMG 体积 250MB，即便是 100Mbps 带宽也要 20-30 秒，普通家用带宽更慢。用户看不出是"产品卡了"还是"在正常下载"、更看不出"下到多少了"——**焦虑感强烈**。

**数据链已存在**：`UpdateProvider` 的 `state.progress: number | null`（0~1）已在 `downloadAndInstall(event => ...)` 回调里维护，当前只是 `AboutSettings` 没消费它。

**方案：** SVG 环形进度条替换 `Loader2`

1. 新建 `src/components/common/ring-progress.tsx`：
   - Props: `progress: number | null, size?: number, strokeWidth?: number`
   - `progress === null` → 退化为 indeterminate（整圈缓慢旋转，提示"准备中"）
   - `progress >= 0` → 两端弧形（从 12 点钟开始顺时针绘制，`stroke-dasharray` 技巧）
   - 中心位置可选展示百分比文字（12px）或纯环形

2. `AboutSettings.tsx` 的按钮 UI：
   ```tsx
   if (status === 'downloading') {
     return {
       icon: <RingProgress progress={progress} size={16} strokeWidth={2} />,
       label: progress !== null
         ? t.update.downloading + ` ${Math.round(progress * 100)}%`
         : t.update.downloading,
       ...
     };
   }
   ```
   - `ready` 态 → 展示 `progress=1`（完整圆圈，不旋转）
   - `installing` 态 → 展示一个带对勾的成功圆圈（或整圈脉冲一下），短暂闪现后 app 就会 relaunch，体感"交付完成"

3. 国际化：`t.update.downloading` 现在是固定字符串"下载中…"，改为支持 `{percent}` 占位符：
   ```ts
   downloading: '下载中…',            // 现有，progress=null 时 fallback
   downloadingPct: '下载中 {percent}%', // 新增
   ```

**验收：**
- [ ] 按钮在 downloading 态展示环形进度 + 百分比，数字平滑递增
- [ ] ready 态展示完整圆圈（不再旋转）
- [ ] 断网 / 失败态仍走 error 分支，不和进度混淆
- [ ] 折叠态 / 展开态按钮尺寸一致，不因 icon 宽度变化抖动

**成本：** 0.5 天（RingProgress 组件 + 接入 + i18n）

---

**状态：** 📋 待实现

**背景：** 桌面 app 的 OAuth 流程完成后（GitHub / Google），浏览器标签页会停留在 Supabase 的 `/auth/v1/callback` 页面上，用户需要手动关闭。体验上像"还在进行中"。

**问题流程：**
1. Google/GitHub 认证成功 → 浏览器跳转 `https://<proj>.supabase.co/auth/v1/callback?code=...`
2. Supabase 服务器 302 → `Sage://auth/callback?code=...`
3. macOS 把 deep link 投给 app，app 完成 `exchangeCodeForSession`
4. 浏览器那个 tab 已经完成使命但**没人关它**，停留在 Supabase 中转页（空白或很朴素）

**候选方案：**
- **A（推荐）**：自托管一个极简回调页（如 `https://auth.Sage.ai/callback`），显示"登录成功，正在返回 Sage…"，用 `window.location = 'Sage://auth/callback?code=...'` 触发 deep link，再 `window.close()` 或让用户手动关闭。需要一个可用域名或 Vercel/Netlify 部署。
- **B**：用 Supabase Edge Function 托管一个 HTML 响应，逻辑同上，不需要额外域名。
- **C**：最便宜的方案——接受现状，只在 LoginPage 或文档里提示一下"看到这个页面可以关闭"。

**决策待定**，先记录。

---

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

**状态：** ✅ 已完成（M2/M3 已交付，2026-04-22）

已在 M2（手动检查更新）和 M3（启动自动检查 + 红点提示）中完成：
- ✅ `tauri-plugin-updater` + `tauri-plugin-process` 集成
- ✅ Ed25519 签名 + GitHub Releases OTA
- ✅ AboutSettings "检查更新"按钮 + 下载/安装/重启全流程
- ✅ 启动 3s 静默检查 + sidebar/设置三级红点提示
- 剩余：更新日志展示（低优先）、下载进度环形条（见 P2 更新按钮进度条条目）

---

### P3 — 知识库（RAG）

**状态：** 📋 待实现

允许用户上传 PDF/文档，构建个人知识库，Agent 可跨文档检索回答。

---

## 🔧 项目结构优化

> **创建日期：** 2026-04-25
> **来源：** 用户提出 + 全项目分析
> **状态：** ✅ 已完成（2026-04-25 验证）

**完成概述：**
- ✅ 根目录 `LOGIN_PAGE_EXAMPLE.tsx`、`README_UI_ANALYSIS.md` 已删除
- ✅ `DESIGN_TOKENS.md`、`UI_STYLE_GUIDE.md`、`UI_QUICK_REFERENCE.md` 已移至 `docs/design/`
- ✅ 6 个 `.env.*` 文件已移至 `configs/env/`
- ✅ `docs/architecture/` 已创建，`Sage_*.md` 重命名为 `SYSTEM.md`/`FRONTEND.md`/`BACKEND.md`/`SYNC.md` 等 6 篇
- ✅ `docs/api/`（2 篇）、`docs/analysis/`（6 篇）、`docs/release-notes/`（含 RELEASE.md + v1.0.0~v1.0.3）均已就位
- ✅ 根目录只剩标准配置文件 + `README.md`，整洁干净

**遗留（非阻塞）：**
- `docs/README.md` 文档索引页尚未创建（锦上添花）
- 项目名称统一（HT Claw / Sage 混用）待品牌决策后一次性处理

### 问题清单

#### 1️⃣ 根目录文件混乱

**现状：**
```
根目录 MD 文件（5 个）：
- DESIGN_TOKENS.md          # 设计令牌文档
- LOGIN_PAGE_EXAMPLE.tsx    # ⚠️ tsx 文件混在 md 中
- README_UI_ANALYSIS.md     # UI 分析文档
- UI_QUICK_REFERENCE.md     # UI 快速参考
- UI_STYLE_GUIDE.md         # UI 样式指南

根目录 .env 文件（6 个）：
- .env.example
- .env.development
- .env.production
- .env.supabase-admin
- .env.minimax-dev
- .env.tauri-signing
```

**问题：**
- 设计文档散落根目录，缺乏组织
- `.env.*` 文件应该在 `configs/env/` 目录
- `LOGIN_PAGE_EXAMPLE.tsx` 是示例代码，不应放在根目录

**优化方案：**
```
根目录清理后：
- 删除 LOGIN_PAGE_EXAMPLE.tsx（示例代码不需要）
- 删除 README_UI_ANALYSIS.md（过时分析文档）
- 移动 DESIGN_TOKENS.md → docs/design/
- 移动 UI_STYLE_GUIDE.md → docs/design/
- 移动 UI_QUICK_REFERENCE.md → docs/design/
- 移动 .env.* → configs/env/

configs/env/ 结构：
configs/
└── env/
    ├── .env.example
    ├── .env.development
    ├── .env.production
    └── ...其他环境文件
```

#### 2️⃣ 项目名称不统一

**现状：**
- `README.md` 称 "HT Claw"
- `PRD.md` / `SPEC.md` 称 "Sage"
- `tauri.conf.json` 称 "Sage"
- `package.json` 称 "Sage"
- 多处混用 "HT Claw" / "Sage" / "Sage"

**建议决策：**
| 层级 | 建议名称 | 说明 |
|------|---------|------|
| 产品名称（对外） | Sage | 中文品牌名 |
| 技术名称（代码/包） | Sage | package.json 已用 |
| 简称（内部/文档） | HT Claw | 简洁易记 |

#### 3️⃣ docs/ 目录结构不规范

**现状：**
```
docs/
├── PRD.md                    # 产品需求文档
├── SPEC.md                   # 技术规格文档
├── TODO.md                   # 任务清单
├── RELEASE.md                # 发版流程
├── Sage_完整系统架构指南.md   # ⚠️ 命名不规范
├── Sage_前端组件架构分析.md   # ⚠️ 命名不规范
├── Sage_后端数据结构分析.md   # ⚠️ 命名不规范
├── Sage_云端同步设计.md      # ⚠️ 命名不规范
├── westock-data-api.md       # API 文档
├── 技能内置说明.md            # ⚠️ 中文命名
├── release-notes/            # 发版记录
│   ├── v1.0.0.md
│   ├── v1.0.1.md
│   └── v1.0.2.md
```

**建议结构：**
```
docs/
├── README.md                 # 文档索引
├── SPEC.md                   # 技术规格（保留）
├── PRD.md                    # 产品需求（保留）
├── TODO.md                   # 任务清单（保留）
├── RELEASE.md                # 发版流程（保留）
├── design/                   # 设计文档
│   ├── OVERVIEW.md          # 设计概览
│   ├── UI_STYLE_GUIDE.md    # 从根目录移入
│   └── ...
├── architecture/             # 架构文档
│   ├── SYSTEM.md            # 系统架构（原Sage_完整系统架构指南）
│   ├── FRONTEND.md          # 前端架构（原Sage_前端组件架构分析）
│   ├── BACKEND.md           # 后端数据（原Sage_后端数据结构分析）
│   └── SYNC.md              # 云端同步（原Sage_云端同步设计）
├── skills/                   # 技能文档
│   ├── westock-data-api.md
│   └── 技能内置说明.md
└── release-notes/            # 发版记录（保留）
```

#### 4️⃣ 其他结构问题

**问题：**
- `.vscode/` 在根目录（可接受，但可考虑移动到 `.github/` 或删除）
- `scripts/` 目录未在 README 中说明用途
- `public/imgs/` 图标文件未组织

---

### 优化任务清单

#### P1 — 根目录 MD 文件整理

| 任务 | 状态 | 优先级 | 成本 |
|------|------|--------|------|
| 删除 `LOGIN_PAGE_EXAMPLE.tsx` | 📋 | P1 | 5min |
| 删除 `README_UI_ANALYSIS.md` | 📋 | P1 | 5min |
| 创建 `docs/design/` 目录 | 📋 | P1 | 5min |
| 移动 `DESIGN_TOKENS.md` → `docs/design/` | 📋 | P1 | 5min |
| 移动 `UI_STYLE_GUIDE.md` → `docs/design/` | 📋 | P1 | 5min |
| 移动 `UI_QUICK_REFERENCE.md` → `docs/design/` | 📋 | P1 | 5min |
| 更新 README 中的文档链接 | 📋 | P1 | 10min |
| 更新 .gitignore（如需要） | 📋 | P1 | 5min |

#### P1 — 根目录 .env 文件整理

| 任务 | 状态 | 优先级 | 成本 |
|------|------|--------|------|
| 创建 `configs/env/` 目录 | 📋 | P1 | 5min |
| 移动所有 `.env.*` → `configs/env/` | 📋 | P1 | 10min |
| 更新所有引用路径（build scripts, README） | 📋 | P1 | 30min |
| 更新 .gitignore | 📋 | P1 | 5min |
| 更新 tauri.conf.json 中的 env 路径 | 📋 | P1 | 10min |

#### P2 — docs/ 目录结构规范化

| 任务 | 状态 | 优先级 | 成本 |
|------|------|--------|------|
| 创建 `docs/README.md` 文档索引 | 📋 | P2 | 20min |
| 创建 `docs/architecture/` 目录 | 📋 | P2 | 5min |
| 重命名 `Sage_*.md` → `architecture/*.md` | 📋 | P2 | 10min |
| 创建 `docs/design/` 目录（如果不存在） | 📋 | P2 | 5min |
| 整理 `docs/skills/` 或保留在原位 | 📋 | P2 | 10min |

#### P2 — 项目名称统一

| 任务 | 状态 | 优先级 | 成本 |
|------|------|--------|------|
| 确定产品正式名称 | 📋 待决策 | P2 | - |
| 更新 README.md 标题 | 📋 | P2 | 5min |
| 更新 PRD.md / SPEC.md 标题 | 📋 | P2 | 5min |
| 在代码注释中统一使用 "Sage" | 📋 | P2 | 30min |
| 创建 `BRANDING.md` 记录命名决策 | 📋 | P2 | 10min |

#### P3 — 其他优化（可选）

| 任务 | 状态 | 优先级 | 成本 |
|------|------|--------|------|
| 清理 `.vscode/` 目录 | 📋 | P3 | 5min |
| 编写 `scripts/` 目录的 README | 📋 | P3 | 10min |
| 组织 `public/imgs/` 图标文件 | 📋 | P3 | 15min |
| 审查并清理其他散落文件 | 📋 | P3 | 20min |

---

### 实施建议

#### 阶段一：快速清理（P1）
1. 删除根目录的 `LOGIN_PAGE_EXAMPLE.tsx` 和 `README_UI_ANALYSIS.md`（立即执行，无风险）
2. 创建 `docs/design/` 和 `configs/env/` 目录
3. 移动文件到对应目录
4. 更新 `.gitignore`

#### 阶段二：文档规范化（P2）
1. 创建 `docs/README.md` 作为文档入口
2. 重命名 `Sage_*.md` 文件
3. 确定并统一项目名称

#### 阶段三：深度优化（P3）
1. 根据需要执行其他清理任务
2. 评估是否需要更复杂的重构

#### 关键原则
- **保持 Git 历史**：使用 `git mv` 移动文件
- **小步提交**：每个阶段单独提交，便于回滚
- **先文档后代码**：先更新文档引用，再执行文件移动
- **测试验证**：每次提交后运行 `pnpm dev` 确保正常

---
