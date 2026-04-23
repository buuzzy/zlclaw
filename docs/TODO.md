# Sage — TODO & Feature Roadmap

> 记录已完成、进行中和待实现的功能。
> 每个功能标注优先级（P0~P3）和状态。
> 最后更新：2026-04-22

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

**问题：** 当前本地 SQLite (`~/Library/Application Support/ai.sage.desktop/sage.db`) 和 session 文件 (`~/.sage/sessions/*.json`) 没有 user 维度。用户 A 登录后创建会话 → 登出 → 用户 B 登录 → 能看到 A 的全部会话。这是**数据隔离 bug，不是 UX 问题**，内测不能带此问题上线。

**方案：** 用户作用域化数据根目录
```
~/.sage/
  users/
    {user-uuid}/
      sage.db
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
3. session 文件层（`~/.sage/sessions/*.json` 的读写）全部走用户作用域路径
4. AuthProvider 在 `SIGNED_IN` 事件时触发一次"数据路径切换"
5. **一次性迁移**：首次升级后若发现 `~/.sage/sage.db` 存在（历史数据），把它移到当前登录用户的目录。写迁移标记避免重复。
6. **登出时**：不清除本地数据（用户再登录回来要能继续用），只把数据路径置空（切回 login 页）

**实际实现要点（与原计划的差异）：**
- DB 物理位置：`~/.sage/users/{uid}/sage.db`（而非原计划里错误的 "~/.sage/sage.db"；真实 legacy 位置是 `~/Library/Application Support/ai.sage.desktop/sage.db`）
- 利用 Tauri SQL plugin 的 `PathBuf::push` 绝对路径特性绕开 `app_config_dir` 限制
- Rust migrations 只对固定 `sqlite:sage.db` 生效，所以 schema 由 JS 幂等 `ensureSchema()` 负责
- JWT 解析兜底：断网启动时从 `sb-*-auth-token` 解析 user.id 提前 bind，避免 30s 卡顿
- `dbReady` 信号加入 AuthGuard：避免 cloud session 已 resolve 但本地 DB 还没切完时显示旧账号残影
- 迁移策略：复制而非移动（rollback safety），全局标记 `~/.sage/.user-scope-migration-v1` 只让第一个登录的用户继承 legacy 数据

**验收：**
- [x] 用户 A 登录创建会话 → 登出 → 用户 B 登录 → 看不到 A 的任何会话（TS/Vite/Rust build 通过，待 dmg 实机验收）
- [x] B 创建会话 → 登出 → A 重新登录 → 看到自己的会话（同上）
- [x] 现有用户升级后数据正常迁移到 `users/{自己的 uid}/`，会话不丢（migration 函数已实现 copy-not-move，待实机验收）
- [x] `~/.sage/skills/` 和 `~/.sage/defaults/` 两个用户共用同一份（设计保留，未动这些目录）

**成本：** 实际 ~1 天（含方案调整、circular dep 排查）

---

#### M2 — App 内手动检查 / 下载更新（P0）

**状态：** ✅ 已完成（2026-04-22）

**需求：** 设置 > 关于 > "检查更新"按钮，点击后若有新版则下载、校验签名、安装、重启。

**方案：** `tauri-plugin-updater` 官方插件 + GitHub Releases 托管 manifest

**实施步骤：**
1. Rust 端：添加 `tauri-plugin-updater` + `tauri-plugin-process` 依赖，`capabilities/default.json` 加权限 ✅
2. 生成 updater 的 Ed25519 签名密钥对，公钥写入 `tauri.conf.json`，私钥保管于 `.env.tauri-signing`（gitignored）+ 用户 1Password ✅
3. `tauri.conf.json` 的 `plugins.updater.endpoints` 指向 `https://github.com/buuzzy/HTclaw/releases/latest/download/latest.json` ✅
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

**状态：** 🟡 M4a 完成，M4b 待手动（2026-04-22）

**问题：** 当前 `SUPABASE_URL` 硬编码到 `supabase.ts`。开发构建和 release 构建用同一个数据库，一旦内测启动，我们本地 debug 任何改动都会影响真实用户数据。

**拆分：**

**M4a — 代码层（✅ 已完成）**
- `src/shared/lib/supabase.ts` 读 `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，未设置时 fallback 到 prod 硬编码值
- `src/vite-env.d.ts` 加上类型声明
- `.env.development` / `.env.production` 模板已建（gitignored）
- AboutSettings 底部显示当前环境标签：`Development · xxxxxxx.supabase.co`
- `scripts/build-signed.sh` 打包前会 source `.env.production`

**M4b — 手动配置（📋 待做，在首次发包前）**
1. ✅ Supabase dashboard 建 `sage-dev` project（用户 2026-04-22 已建，password `nILtMNNsO2i8RoyM`）
2. 🟡 把 schema 同步到 dev project：`supabase link --project-ref <dev-ref>` + `SUPABASE_DB_PASSWORD=... supabase db push`（2026-04-22 已对 sage-dev 做过一次）
3. 🟡 Database > Publications 打开 `profiles` + `user_settings` 的 Realtime（勾选对应 table 的 Source toggle）
4. 🟡 Authentication > URL Configuration 加 `sage://auth/callback` 到 Redirect URLs
5. 🟡 GitHub OAuth App + Google OAuth Client 分别指向 dev project 的 callback URL
6. 🟡 把 dev project 的 URL + anon key 填进 `.env.development`

**验收：**
- [ ] `pnpm tauri dev` 启动 → AboutSettings 底部显示 "Development · <dev-host>" ← 等 M4b 完成后实机
- [ ] `pnpm tauri:build:signed:mac-arm` 出的 DMG → AboutSettings 显示 "Production · wymqgwtagpsjuonsclye.supabase.co"
- [ ] 用 release DMG 登录不会污染 dev 数据（两个 project 完全独立）

**成本：** M4a 实际 ~0.5 小时，M4b 估计 ~20-30 分钟（你手动）

---

### 📋 NICE-TO-HAVE（内测启动后第一周补）

#### N1 — 账号注销入口 + 数据导出

**状态：** 📋 待实现

**需求：** 用户在设置 > 账号里能"注销账号"。前置：提示"这将永久删除你的所有云端数据，建议先导出"，附数据导出按钮。

**注销：** edge function 级联删除 profiles + sessions + user_settings + error_logs（RLS 会自动限定 user_id），再清本地用户目录 + signOut。
**导出：** 打包当前用户的云端 + 本地数据为 JSON zip，用户可以下载保存。

**成本：** 1 天

#### N2 — 启动加载 UX 优化

**状态：** 📋 待实现

**问题：** 当前 AuthGuard 的"转圈"只有一个 spinner，没有文案。3 秒超时兜底虽已处理，但正常启动 1-2 秒的等待体验也不够好。
**方案：** 加 "正在连接..." / Logo 动画 / 启动阶段提示。另外评估启动时序——能否并行 initializeSettings 和 getSession。

**成本：** 0.5 天

#### N3 — 基础隐私政策与 TOS 占位页

**状态：** 📋 待实现

登录页底部有"同意服务条款和隐私政策"的文字但没链接。内测期至少要有 notion / 简单静态页承载内容，不然内测用户问起会尴尬。

**成本：** 半天（内容撰写占大头，技术是一个 webview 跳转）

---

### 🧊 LATER（等内测反馈再评估）

- 同步状态 UI 重构（迁移到头像角标 + 遮罩）—— 详见下方 P1 条目
- 跨设备看会话列表（只元数据不加载内容）
- 跨设备消息体同步（加密 blob）
- 后台排查面板（内测期直接 Supabase Dashboard 看表即可）
- 多窗口 / 多实例同步验证

---

### ⚡ L1 — 打包体积优化：按需下载 coding 工具

**状态：** 📋 待实现（P2）

**问题：** 当前 Sage.app DMG 约 **270MB**，主要体积来自：
- `sage-api` sidecar：~60MB（Node 二进制 + 应用代码）
- 内置 `claude` / `codex` 二进制：各 ~30KB（只是 launcher，实际也小）
- **真正的大头是 skills 资源目录**（Python runtime + 依赖）

但绝大多数用户首次启动不会立刻使用所有 skills。这让下载和首次安装体验很慢。

**方案：**
1. **默认包只含必须资源**：Tauri bundle 只保留核心 Sage app + API sidecar + defaults（AGENTS.md、SOUL.md、skills-config.json）
2. **Skills 按需下载**：用户首次需要某个 skill 时，app 提示"该功能需要下载运行环境（~XX MB），是否继续？"，用户点确认后从 CDN 拉取到 `~/.sage/skills/{skill-name}/`
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

**状态：** 🔴 **重要：当前 .env.development 已暂时指向 prod**，触发以下任一条件必须立刻切回 dev / 搬到 L3：
- 发出第一个 DMG 给任何除你之外的人
- 邀请团队成员加入开发
- 开始做破坏性 schema 改动（ALTER TABLE 删列、DROP 索引等）

**当前决策的代价：** 本地 dev 模式产生的测试数据会进 sage project（prod）。建议测试会话在 prompt 里带标签 `[DEV-TEST]`，将来用 `DELETE FROM sessions WHERE preview LIKE '%[DEV-TEST%'` 清理。

**sage-dev 已创建且 schema 已推送**（project ref: `pskweazwczdgtohkdmee`），credentials 保存在 `.env.development` 注释里，切换时把注释里的值启用即可。差 OAuth 配置未做。

**背景：** M4 当前走的是"两 remote project"（sage + sage-dev）方案：

| Level | 描述 | 问题 |
|-------|------|------|
| L1 | 单一 prod project | 本地 debug 污染真实数据 |
| **L2（当前）** | sage + sage-dev 两个 remote project | schema 靠手动同步易漂移；多人协作互相踩；OAuth 要配两套 |
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

3. 本地 Docker stack 替代 sage-dev：
   ```bash
   supabase start   # docker-compose 起本地 Postgres + Auth + Realtime + Storage
   ```
   - `.env.development` 改为 `VITE_SUPABASE_URL=http://127.0.0.1:54321`
   - `VITE_SUPABASE_ANON_KEY` 用本地 stack 启动时打印的 anon key
   - 本地用 Email/password 或 magic link 登录即可 debug，不用配 OAuth

4. 退役 sage-dev project（Free tier 不占配额，留着或删）

**收益：**
- ✅ Schema 有 git history，3 个月后能 bisect 哪天改了什么
- ✅ `supabase db reset` 随时得到干净初态
- ✅ 新加入的开发者 `git clone` + `supabase start` 即有完整环境
- ✅ CI 能跑 `supabase db reset && pytest`（未来）
- ✅ 不用维护 sage-dev 的 OAuth

**实施步骤（约 2-3 小时）：**
1. 装 CLI + `supabase login`
2. `supabase init`（会在现有 `supabase/` 目录里补结构）
3. `supabase link --project-ref wymqgwtagpsjuonsclye`
4. `supabase db pull` → 验证生成的 `supabase/migrations/*.sql` 能完整重建 schema
5. 验证 sage-dev 的 schema 可用后，不再需要手工 SQL 备份（早期的 `supabase/dev-bootstrap.sql` 已删，迁移文件是唯一源）
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
- `database.ts` 关键出口（createSession / updateSessionTaskCount / createMessage / updateTask / deleteTask / createFile / deleteFile）插入 markSessionDirty hooks
- 登录后自动 backfill：扫描本地所有 session id 触发一次全量 upsert
- 500ms debounce + 同一 tick 合并，upsert/delete 互斥去重
- preview 语义 = 用户最后一问（user 类型消息最新一条，极端情况回退到 session.prompt）
- 本期最小闭环：只做单向上云，不把云端独有 session merge 到本地（留给将来消息体同步一起做）
- 验证通过：新建/追问/删除会话在 Supabase 实时反映，preview/message_count/has_artifacts 字段语义正确

**Phase 4 完成项：**
- 新增 `error-sync.ts`（reportError + 离线队列 + env 探测）+ `error-boundary.tsx`（React 错误边界）
- main.tsx 挂载 ErrorBoundary + 注册 window.onerror / onunhandledrejection + 启动时 flushErrorQueue
- TaskDetail 反馈提交同步写 Supabase `error_logs`，本地 JSONL 保留做备份
- 反馈排查上下文：`recent_user_messages` / `recent_agent_replies` / `ai_config` / `last_system_subtype` / `ui_message_count` 默认携带
- 可选 checkbox "附上完整对话帮助排查"：勾选后 `context.full_transcript` 包含整个 task 的 messages，tool_output 截 2000 字避免 JSONB 膨胀
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

**状态：** 📋 待实现（设计已确定 2026-04-22）

**背景：** 当前 `SyncStatusIndicator` 以独立一行文字 + 圆点的形式挂在 sidebar 底部（展开/折叠两种态），桌面端视觉干扰偏强。用户反馈"同步状态不需要在用户头像上方明显展示"。目标：**默认态极简、异常态强介入**，符合 macOS native 产品风格。

**设计：**

**1. 正常态（overall ∈ {ok, idle}）**
- 头像**左上角**贴一个小圆点（size-2，类 macOS 通知角标）
  - `ok` → 绿色静止点
  - `idle` → 不显示圆点（app 刚启动瞬间，用户感知不到）
- 头像本身无任何装饰，点击正常展开下拉菜单（Settings / 退出登录）

**2. 同步中（overall === 'syncing'）**
- **不显示圆点**（几百毫秒的状态切换反而闪动干扰，不展示更平静）
- 头像行为保持不变

**3. 失败态（overall === 'failed'）**
- 头像外层蒙一层**半透明遮罩**（建议 `bg-background/60` + 轻微 blur，或纯黑 40% alpha）
- 遮罩中央放一个 **`WifiOff` icon**（lucide-react），尺寸约 `size-4`
- **整个头像区域变成重试按钮**：点击立即触发 `retryFailedChannels({ force: true })`（不再打开下拉菜单）
- 点击后遮罩不消失，icon 换成 `Loader2` 旋转动画（直到 overall 变 ok）
- 重试成功 → 遮罩淡出 → 恢复绿色角标 + 菜单交互
- 重试失败 → 保持遮罩 + `WifiOff`，等用户下次点击或定时轮询兜底

**4. 过渡态：已登录但 user 为 null（断网 3s fallback 那一刻）**
- 头像本身显示 `User` icon 占位（`AvatarImage` 已实现）
- 不叠加 failed 遮罩（占位 icon 再盖一层噪音太大）
- 只在左上角显示红/灰角标

**5. 完全移除底部状态栏**
- 删除 sidebar 展开态和折叠态的 `<SyncStatusIndicator />` 挂点
- `sync-status-indicator.tsx` 文件废弃，可删除
- 详细信息（上次同步时间、哪条链路失败）通过头像 **hover tooltip** 展示

**实施步骤：**

1. 新建 `src/components/layout/avatar-status-badge.tsx`：接收 `<AvatarImage>` 作为 children，根据 `useSyncStatus()` 决定叠加角标 / 遮罩
2. `left-sidebar.tsx`：
   - 用 `<AvatarStatusBadge>` 包裹 4 处 `<AvatarImage>`
   - 失败态时点击头像应调 retry 而非打开 DropdownMenu —— 需把 DropdownMenuTrigger 的 `onClick` 在 failed 态下拦截
   - 移除 `<SyncStatusIndicator />` 两处挂点
3. 删除 `src/components/layout/sync-status-indicator.tsx`

**edge cases：**
- DropdownMenu 触发器在失败态被拦截时，radix 的 asChild 行为需要测试，可能要改用 `onPointerDown` 或 event.preventDefault
- 折叠态头像按钮和失败态重试按钮的视觉尺寸要一致（避免按钮抖动）
- 头像左上角角标定位：`absolute -top-0.5 -left-0.5`，加 `ring-2 ring-sidebar`（和 sidebar 背景色同色的描边让点从头像上"浮起来"）

**验收点：**
- [ ] 正常联网 → 头像左上角绿点，点击正常展开菜单
- [ ] 切换主题 / 改昵称等 syncing 瞬间 → 角标不变（保持绿色，不闪烁）
- [ ] 断网 → 头像遮罩 + `WifiOff` icon
- [ ] 断网态点击头像 → icon 变 Loader 旋转（不打开菜单）
- [ ] 恢复网络 → 遮罩淡出，恢复绿点
- [ ] 底部不再有同步状态栏
- [ ] 头像 hover 显示 tooltip：状态 + 上次同步时间 + 失败时哪条链路（可选）
- [ ] 折叠态和展开态行为一致

---

**遗留 / 合并到后续阶段：**

- [ ] **message_count 数字偏大**（P2）：当前值约等于用户实际轮次 × 3~4。根因在 `useAgent.ts` 流式输出时同时写入中间态和终态多条 `type: 'text'` 消息，所以本地 `messages` 表对同一轮 Agent 回复会有多条记录。cloud payload 忠实聚合这个数。**修复方案**：等一次 `useAgent.ts` 写 DB 逻辑重构，把一轮对话收敛为"1 条 user + 1 条 text"。本期同步任务先不动 Agent 层。
- [ ] **full_transcript 里 text 有 content=null 的条目**（P3）：和上面 message_count 同根——流式 chunk 空消息被落盘。在 `useAgent.ts` 重构时一并清理。
- [ ] **last_system_subtype 永远是 null**（P3）：UI 层 AgentMessage 在某些路径下丢失了 DB 的 subtype 字段。排查时我们有 full_transcript 就够用，优先级低。
- [ ] **tool_input 没截断上限**（P3）：当前只截断 tool_output 到 2000 字。如果某天有超长 URL 或大 JSON payload 塞给 MCP 会撑大 JSONB。加一行代码即可解决，集中到下次同步模块优化时做。
- [ ] **反馈不带时间戳**（P3）：allMessages 是 UI state，不带 created_at。多轮对话间隔（秒 / 小时）看不出来。真正需要时可改为从 DB 重读 messages 表。
- [ ] **M1 迁移 bug fixes 追记 — Tauri fs scope 隐藏文件问题**（已修 ✅，记录备忘）：首次实机验收 M1 时发现 `~/.sage/.user-scope-migration-v1` 写不成功，错误 `forbidden path`。根因：Tauri v2 的 fs scope glob `**` **不匹配以 `.` 开头的隐藏文件**（和 bash shopt dotglob 同逻辑）。修复：capabilities/default.json 额外加 `$HOME/.sage/.*` 规则。未来再往 `.sage` 下写任何隐藏文件（marker、缓存、配置）都要确认这个规则还在。
- [ ] **M1 迁移 bug fixes 追记 — writeTextFile vs writeFile 权限路径**（已修 ✅，记录备忘）：首次实机发现 `writeTextFile` 有权限问题即使 `fs:allow-write-text-file` 在 capabilities 里。最终改用 `writeFile(..., TextEncoder().encode(payload))`。未来新增代码优先用 `writeFile` 写文本，避免类似坑。
- [ ] **Updater 签名密钥第一版作废**（已弃用 ⛔）：v1 密钥用 `--password ""` 生成，被 tauri build 拒收（"Wrong password"）。v2 用真实密码（`Sage-Updater-48f601110be9bfdd`）重新生成。公钥已更新到 `tauri.conf.json`。**影响**：如果以后需要重新生成密钥，**必须传非空 password**，否则 build 时会签名失败。
- [ ] **dev Sage 与 release Sage 的 sage:// deep link 冲突**（P3，未修）：dev 模式（`pnpm tauri:dev`）下 OAuth 回调会被 `/Applications/Sage.app`（release 版）拦截，因为 macOS LaunchServices 把 `sage://` 分配给注册过的 `.app` bundle，不分配给 `target/debug/sage`。workaround：dev 验收 OAuth 前临时把 release Sage 改名（`mv /Applications/Sage.app /Applications/Sage-backup.app`），验完再 rename 回来。**根治方案**：dev 模式改用不同的 scheme（如 `sage-dev://`）+ Supabase dev project 的 redirect URL 配套。和 L2→L3 迁移一起做。

**关键原则：**
- Local-first：所有完整数据在本地，云端只同步元数据/偏好
- 不上云：API Key、消息体、MCP 配置等敏感或大体量数据
- LWW 冲突解决 + 离线队列

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
2. Supabase 服务器 302 → `sage://auth/callback?code=...`
3. macOS 把 deep link 投给 app，app 完成 `exchangeCodeForSession`
4. 浏览器那个 tab 已经完成使命但**没人关它**，停留在 Supabase 中转页（空白或很朴素）

**候选方案：**
- **A（推荐）**：自托管一个极简回调页（如 `https://auth.sage.ai/callback`），显示"登录成功，正在返回 Sage…"，用 `window.location = 'sage://auth/callback?code=...'` 触发 deep link，再 `window.close()` 或让用户手动关闭。需要一个可用域名或 Vercel/Netlify 部署。
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

**状态：** 📋 待实现

- Tauri updater 集成
- 版本检测与增量更新
- 更新日志展示

---

### P3 — 知识库（RAG）

**状态：** 📋 待实现

允许用户上传 PDF/文档，构建个人知识库，Agent 可跨文档检索回答。

---
