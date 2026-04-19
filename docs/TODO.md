# HTclaw — TODO & Feature Roadmap

> 记录已完成、进行中和待实现的功能。  
> 每个功能标注优先级（P0~P3）和状态。

---

## 已完成 ✅

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

**实现文件：**
- `src/components/settings/tabs/MemorySettings.tsx` — 新增面板组件
- `src/components/settings/types.ts` — 添加 `'memory'` 类别
- `src/components/settings/constants.tsx` — 添加 `Brain` 图标映射
- `src/components/settings/SettingsModal.tsx` — 注册路由和渲染
- `src/config/locale/messages/zh/settings.ts` — 中文 i18n
- `src/config/locale/messages/en/settings.ts` — 英文 i18n

---

### Cron 任务 UI — Jitter 配置（Settings > Cron）
**状态：** ✅ 完成

在「新建定时任务」对话框中增加执行抖动（Jitter）配置，避免所有任务整点堆积。

**功能：**
- 仅对非一次性任务（`scheduleType !== 'at'`）显示
- Toggle 开关（默认开启）+ 秒数输入框（0–3600，默认 30 秒）
- POST 创建时携带 `jitter` 字段（毫秒），关闭时传 0

**实现文件：**
- `src/components/settings/tabs/CronSettings.tsx` — 状态变量 + UI + POST body

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

**设计原则：** 删除的不是「记忆」，而是「原始转录」。每日对话的关键信息通过 consolidator 提炼后永久保存在 MEMORY.md，Agent 始终能「想起来」。

**实现文件：**
- `src-api/src/shared/memory/indexer.ts` — 热层过滤 + 过期 chunk 驱逐
- `src-api/src/shared/memory/search.ts` — 来源权重系数
- `src-api/src/shared/memory/consolidator.ts` — 归纳后主动毕业日文件 chunk

---

### F25 — 每日记忆归纳
**状态：** ✅ 完成（含架构升级）

每晚 23:00 将 `~/.htclaw/memory/YYYY-MM-DD.md` 中的日常对话
提炼为结构化长期记忆，追加到 `~/.htclaw/MEMORY.md`。

**实现文件：**
- `src-api/src/shared/memory/consolidator.ts` — 核心逻辑（扫描、LLM摘要、写入标记文件、触发向量重索引）
- `src-api/src/app/api/memory.ts` — `POST /memory/consolidate` 手动触发端点
- 通过 Cron 调度器自动注册为系统 Job（id: `sys-memory-consolidation`，每天 23:00）

**幂等性保障：**  
每个处理过的日期文件写入 `.YYYY-MM-DD.consolidated` 标记文件，崩溃重启后不会重复处理。

---

### Cron 调度系统（F24 基础设施）
**状态：** ✅ 后端完成，前端 UI 待实现

用户可管理的定时任务系统，支持通过 REST API 或（未来）自然语言创建定时 Agent 任务。

**设计参考：** OpenClaw 的 cron-tool 架构，针对 HTclaw 金融场景简化。

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
         ↓（可选）channel delivery（待完善）
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

#### Schedule 类型
```json
// Cron 表达式（最常用）
{ "type": "cron", "expression": "15 9 * * 1-5", "timezone": "Asia/Shanghai" }

// 固定间隔
{ "type": "every", "interval": 3600000 }

// 一次性（at + deleteAfterRun: true）
{ "type": "at", "at": "2026-04-18T09:00:00+08:00" }
```

#### 内置系统 Job（不可删除，可禁用）
| ID | 名称 | 触发时间 |
|----|------|---------|
| `sys-memory-consolidation` | 每日记忆归纳 (F25) | 每天 23:00 |

---

### Consolidator baseUrl `#` Bug 修复
**状态：** ✅ 完成

**问题：** `config.json` 中 `baseUrl` 末尾带有 `#`（如 `http://host/api/llmproxy#`），用于 Agent SDK 内部路由。但 consolidator 使用原生 `fetch()` 直接拼接路径时，Node.js 将 `#` 后内容视为 URL fragment 静默丢弃，导致 LLM 请求发往错误路径，归纳失败 — 而 cron scheduler 不感知 `result.failed[]`，仍报 `status: 'success'`。

**修复：** 在 `callLLM()` 中对 baseUrl 做清洗后再使用：
```typescript
const baseUrl = rawBaseUrl.replace(/#.*$/, '').replace(/\/$/, '');
```

**实现文件：**
- `src-api/src/shared/memory/consolidator.ts` — `callLLM()` 中剥离 `#` 及后续字符

---

### 夜间记忆归纳验证（consolidator 端到端测试）
**状态：** ✅ 完成（2026-04-18 手动验证）

验证了完整的 consolidator 流程：
- ✅ 手动触发 `POST /memory/consolidate`（Settings > Memory > 立即归纳记忆）
- ✅ LLM 成功提炼 `2026-04-16.md` → 写入 `MEMORY.md`（`## 2026-04-16 每日归纳` 四节结构）
- ✅ `.2026-04-16.consolidated` 标记文件已生成，幂等保护正常
- ✅ MEMORY.md 触发向量重索引
- ✅ jobs.json 输出：`Processed: 2026-04-16, Skipped: 0, Failed: none`

**注：** 首次验证失败原因为 baseUrl `#` bug（见上条），修复后验证通过。

---

### Session 删除后复活 Bug 修复
**状态：** ✅ 完成（2026-04-19）

**问题背景：** 用户在前端删除一个 Session 后，几秒内任务又重新出现在列表中。

**根本原因（两处）：**

1. **`clearDeletedIds` 时机错误**（`useChannelSync.ts`）  
   原代码在每次 poll 成功后无条件调用 `clearDeletedIds()`，立即清空 localStorage 中的删除黑名单 → 下次 poll（3 秒后）重新从后端拉取该对话 → 重建 Task。  
   **修复：** 改为选择性清理——仅当后端不再返回某个 ID 时，才将其从黑名单移除。

2. **5 秒 loadTasks 轮询覆盖 React state**（`Home.tsx`）  
   原代码 `setInterval(loadTasks, 5000)` 每 5 秒重新从 SQLite 拉取全量 Tasks 并覆盖 React state，如果后端在此期间重建了 Task，会重新出现在 UI 中。  
   **修复：** 删除 `setInterval`，改为仅在 `useChannelSync` 的 `onNewTask` 回调触发时刷新。

3. **后端存储未清除**  
   前端删除 Task 时只清除了本地 SQLite，但 `/channels/conversations/:id` 仍保留 → sidecar 重启后黑名单丢失，任务复活。  
   **修复：** `handleDeleteTask` 中增加 `DELETE /channels/conversations/:id` 调用。

**实现文件：**
- `src/shared/hooks/useChannelSync.ts` — 选择性 deletedIds 清理逻辑
- `src/app/pages/Home.tsx` — 移除 5 秒 loadTasks 轮询 + 增加 DELETE 请求

---

## 进行中 🚧

（暂无）

---

## 待实现 📋

### P0 — 多模型配置 UX 优化

**状态：** 📋 待实现  
**背景：** 来自竞品分析（2026-04-19），经代码核查后修正定性（2026-04-19）

**实际现状（非"Claude 绑定"）：**

通过代码核查，HTclaw **不存在硬性 Claude 依赖**，技术层面已支持多模型：
- Agent 执行层：`@codeany/open-agent-sdk` + `AgentConfig.apiType: 'anthropic-messages' | 'openai-completions'` — 协议可切换
- Chat 轻量层：`ChatService` 中 `isAnthropicModel(model)` 判断，非 Claude 模型走 OpenAI-compatible raw fetch
- 用户已可手动填写 apiKey + baseURL + model name 接入任意兼容模型（DeepSeek、Qwen 等）

**真正的 Gap — 配置体验：**
- 没有预设 Provider 选项，用户需自行查找各厂商 baseURL
- 连接测试不区分协议类型，错误提示不明确（Anthropic 和 OpenAI 错误格式不同）
- 不支持 per-task 模型覆盖（全局一个配置）
- Ollama 本地部署路径未验证和文档化

**改进方案：**

```
Settings > 模型配置 改版：
  ├── Provider 下拉选择（Anthropic / DeepSeek / OpenAI / Gemini / Ollama / 自定义）
  │     → 选中后自动填充 baseURL 和 apiType，只需填 apiKey + model name
  ├── 连接测试区分 Anthropic / OpenAI 协议，给出协议特定错误提示
  ├── 每个技能/Cron Job 支持指定覆盖模型（可选，不填则用全局配置）
  └── Ollama 选项：baseURL 默认 http://localhost:11434，apiType = openai-completions
```

预设 baseURL 参考：
```
DeepSeek:  https://api.deepseek.com/v1
Gemini:    https://generativelanguage.googleapis.com/v1beta/openai
OpenAI:    https://api.openai.com/v1
Ollama:    http://localhost:11434/v1
```

**优先级说明：** 对国内用户，DeepSeek 接入路径（无需翻墙 + 价格低）是最高价值改进项，应优先实现。

**实现文件规划：**
- `src/components/settings/tabs/ModelSettings.tsx` — 前端 Provider 选择 + 预设填充
- `src-api/src/shared/config/providers.ts` — Provider 预设配置（baseURL、apiType、占位 model）
- `src-api/src/app/api/settings.ts` — 连接测试逻辑增强（区分协议错误）

---

### P0 — 技能经验学习闭环

**状态：** 📋 待实现  
**背景：** 来自竞品分析（Hermes Agent 核心差异化能力，2026-04-19）

**问题：** HTclaw 的技能完全由开发者手写，没有任何自学习机制。Hermes Agent 从执行经验中自动抽取可复用技能，下次遇到类似任务直接调用已验证路径。随着任务复杂度提升，这个差距会越来越明显。

---

#### Hermes Agent 的实际实现机制（代码层验证，2026-04-19）

> **注：** 以下基于对 Hermes Agent 源码的实际分析，纠正了早期文档中"置信度评分 + 多阶段晋升"的错误设计预设。

**核心设计：Background Review Agent（后台评审 Agent）**

Hermes 的学习机制极其简洁——**把是否要写技能的判断完全委托给 LLM**，无任何数值评分：

```
任务执行中 → 每 N 次工具调用后（_iters_since_skill >= 10）
  → _spawn_background_review() 在后台 fork 一个静默 AIAgent
  → 该 Agent 收到完整对话历史 + _SKILL_REVIEW_PROMPT：
      "有没有试错过程？有没有可复用的方法？用户是否表达过偏好？"
  → Agent 调用 skill_manage(action='create' | 'patch')
      → 写入 ~/.hermes/skills/<名称>/SKILL.md（YAML frontmatter + markdown body）
  → 下次任务：skills 索引（name + description）注入 system prompt 的 <available_skills> 块
  → Agent 需要某技能时调用 skill_view(name) → 按需加载完整内容
```

**关键设计决策：**

| 决策 | Hermes 的选择 | 原因 |
|------|--------------|------|
| 何时触发评审 | 工具调用次数计数器（`_iters_since_skill`） | 任务越复杂，触发越多次 |
| 谁决定是否写技能 | LLM 自主判断 | 无数值阈值，减少误判 |
| 技能存储格式 | YAML frontmatter + markdown | 人类可读，Agent 可写 |
| 技能加载方式 | 索引常驻 + 按需全文加载 | 控制 context 长度 |
| 技能更新 | `patch` action 修改已有技能 | 迭代改进，不是替换 |

**安全层（skills_guard）：** 技能写入前先过安全扫描（检查是否含系统命令、数据泄露风险），拦截 Agent 写入恶意技能。

---

#### HTclaw 的现有基础

HTclaw 已具备技能系统的基本框架：

- `registerFilesystemSkills()` — 启动时扫描 `~/.htclaw/skills/` 并注册
- `~/.htclaw/skills/<名称>/SKILL.md` — 与 Hermes 相同的磁盘结构
- Agent `Skill` tool — 执行时可调用已注册技能

**缺少的三块：**

1. **`skill_manage` 写入工具** — Agent 没有向 `~/.htclaw/skills/` 写入 SKILL.md 的 tool，无法自己创建/更新技能
2. **后台评审触发机制** — AgentRunner 没有在工具调用达到阈值时 fork 后台评审 Agent 的逻辑
3. **评审 prompt 设计** — 需要一个针对 HTclaw 金融场景的 Review Prompt，引导 Agent 识别值得固化的经验

---

#### HTclaw 适合固化的经验类型

| 经验类型 | 示例 |
|---------|------|
| API 调用模式 | 「查 A 股基本面」→ 先 westock-market 拿报价，再 westock-research 拿财报，最后生成对比表 |
| 用户展示偏好 | 用户总是要求 K 线图附带成交量柱，单独的价格折线图会被追问「能加上量吗」 |
| 分析方法论 | 基本面分析固定顺序：PE/PB 历史百分位 → ROE 趋势 → 自由现金流 → 商誉减值风险 |
| 飞书推送格式 | 早报格式：三段式（市场概览 → 个股追踪 → 今日关注），超过 600 字用户会跳过不读 |
| 错误恢复路径 | westock-screener 超时 → 自动降级为分批查询（每批 ≤50 只），无需用户重新触发 |

---

#### 实现方案（参考 Hermes，适配 HTclaw）

**第一步：`skill_manage` 写入工具**

```typescript
// src-api/src/shared/skills/skill-manage-tool.ts
// Agent 可调用的新工具：创建或更新 ~/.htclaw/skills/<name>/SKILL.md
interface SkillManageInput {
  action: 'create' | 'patch';
  name: string;            // skill 目录名（英文连字符格式）
  title: string;           // SKILL.md 中的展示标题
  description: string;     // 一句话描述，用于 system prompt 的 <available_skills> 索引
  trigger: string;         // 触发条件（何时使用此技能）
  steps: string;           // 具体操作步骤（markdown）
  notes?: string;          // 注意事项
}
```

**第二步：后台评审触发**

```typescript
// src-api/src/app/agent/agent-runner.ts（修改）
// 在 AgentRunner 的工具调用回调中，累计计数
// 每 10 次工具调用后，在后台 fork 一个静默 review session：
//   - 传入当前完整对话历史
//   - 使用 SKILL_REVIEW_PROMPT
//   - max_iterations: 5，不返回流式输出
```

**第三步：HTclaw 评审 Prompt**

```
你是 HTclaw 技能评审 Agent。请阅读上方的完整对话历史，判断是否存在值得固化为可复用技能的经验。

评估维度：
1. 是否有明显的试错过程（多次调用同类 API、调整参数）？
2. 是否出现了可以抽象为通用步骤的成功路径？
3. 用户是否明确表达了展示偏好或格式要求？
4. 是否发现了某个数据源的规律（如字段格式、限流策略、降级方案）？

如果以上任意一项为"是"，调用 skill_manage(action='create') 或 skill_manage(action='patch') 写入技能。
如果没有值得固化的经验，直接结束，不要输出任何内容。
```

**实现文件规划：**
- `src-api/src/shared/skills/skill-manage-tool.ts` — `skill_manage` 工具实现（写入 SKILL.md + skills_guard 安全扫描）
- `src-api/src/shared/skills/skill-review-prompt.ts` — 评审 prompt 常量
- `src-api/src/app/agent/agent-runner.ts` — 添加工具调用计数器 + 后台评审 fork 逻辑
- `src-api/src/shared/skills/skill-index.ts` — skills 索引生成（name + description → `<available_skills>` 块）

---

### P1 — OKX 全链路交易集成

**状态：** 💡 构思中（2026-04-19）

#### 背景

HTclaw 当前已覆盖 A 股的行情获取（westock-market）、投研分析（westock-research）、选股筛选（westock-screener）和股单管理（westock-market 接口六）。但 A 股存在一个根本限制：**券商 API 不对个人开放**，AI 完成分析后用户仍需手动到券商 App 执行交易，链路断裂。

OKX 开放了完整的 REST + WebSocket API（免申请，API Key 即可使用），覆盖现货、合约、期权全品类，支持行情查询、账户管理、下单交易。这使 HTclaw 有机会在加密资产方向实现**从行情 → 分析 → 下单的完整闭环**，弥补 A 股执行端的空白。

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
| `GET /api/v5/market/tickers` | 全市场行情概览（可按 instType 过滤：SPOT/SWAP） |
| `GET /api/v5/market/candles` | K 线数据（支持 1m/5m/1H/4H/1D 等 13 种粒度） |
| `GET /api/v5/market/books` | 盘口深度（买卖挂单分布） |
| `GET /api/v5/market/trades` | 最近成交记录 |
| `GET /api/v5/rubik/stat/taker-volume` | 主动买/卖成交量比（判断多空力量） |
| `GET /api/v5/rubik/stat/contracts/long-short-account-ratio` | 多空持仓人数比 |
| `GET /api/v5/public/funding-rate` | 当前资金费率（合约特有指标） |
| `GET /api/v5/public/open-interest` | 持仓量（反映市场参与度） |

与 westock 系列的差异：
- A 股行情来自腾讯财经代理，只有日线/分钟线
- OKX 提供秒级 WebSocket 推送，Agent 可实时感知价格变动
- 资金费率、多空比、持仓量是加密市场独有的衍生品指标，A 股无对应数据

**第二阶段：`okx-account` Skill — 账户与持仓（只读，需 API Key）**

新增 `okx-account` Skill，封装账户查询类接口（仅需 `read` 权限的 API Key，无交易风险）：

| 接口 | 说明 |
|------|------|
| `GET /api/v5/account/balance` | 账户余额（各币种可用/冻结） |
| `GET /api/v5/account/positions` | 当前持仓（合约仓位、杠杆、盈亏） |
| `GET /api/v5/trade/orders-pending` | 当前挂单列表 |
| `GET /api/v5/trade/fills` | 历史成交记录 |
| `GET /api/v5/account/bills` | 账单流水（充提、手续费、资金费） |

API Key 配置：存入 `~/.htclaw/config.json` 的 `okx` 字段（`apiKey` / `secretKey` / `passphrase`），在 Settings > Connector 面板配置，不随代码提交。

**第三阶段：`okx-trade` Skill — 下单执行（需 trade 权限 API Key）**

这是最核心也最需要谨慎设计的部分。

核心原则：**AI 只负责计算和提案，执行权始终在用户手中。**

交互流程：
```
用户：把我 20% 的 USDT 在当前价附近买入 BTC

AI 分析：
  当前 BTC 价格：$84,200
  账户 USDT 余额：10,000
  建议下单：限价 $84,000，数量 0.0238 BTC，花费 2,000 USDT

  ┌─────────────────────────────────────────┐
  │  📋 待确认订单                           │
  │  BTC-USDT 现货 · 买入                   │
  │  价格：$84,000   数量：0.0238 BTC       │
  │  金额：≈ 2,000 USDT（占余额 20%）       │
  │                                         │
  │  [✅ 确认下单]        [❌ 取消]          │
  └─────────────────────────────────────────┘

用户点击"确认下单" → 调用 POST /api/v5/trade/order
```

封装接口：

| 接口 | 说明 |
|------|------|
| `POST /api/v5/trade/order` | 单笔下单（市价/限价/止损） |
| `POST /api/v5/trade/batch-orders` | 批量下单 |
| `POST /api/v5/trade/cancel-order` | 撤单 |
| `POST /api/v5/trade/cancel-batch-orders` | 批量撤单 |
| `POST /api/v5/trade/amend-order` | 改单（修改价格/数量） |

风控配置（存入 `config.json`，用户可在设置面板调整）：
```json
{
  "okx": {
    "trade": {
      "enabled": true,
      "allowedInstTypes": ["SPOT"],      // 默认只允许现货，防止合约爆仓
      "maxSingleOrderUSDT": 1000,        // 单笔最大下单金额
      "maxDailyTradeUSDT": 5000,         // 每日累计交易上限
      "requireConfirmation": true        // 必须用户手动确认（不可关闭）
    }
  }
}
```

#### 与现有系统的集成点

1. **Cron 定时任务**：可创建「每天 9:00 拉取 BTC/ETH 行情 + 资金费率，生成每日加密早报推送飞书」
2. **westock 协同**：AI 可同时分析 A 股和加密市场，做跨市场相关性分析（如美股科技股 → BTC 联动）
3. **记忆系统**：用户的加密投资偏好、风险偏好、历史操作习惯写入 MEMORY.md，下次分析自动参考
4. **飞书/微信渠道**：在飞书群里 @ 机器人「BTC 当前怎么样」，返回实时行情卡片

#### 技术实现要点

- OKX API 签名：每个请求需要 HMAC-SHA256 签名（timestamp + method + requestPath + body），封装为 `src-api/src/shared/utils/okx-auth.ts`
- WebSocket 实时推送：行情监控类 Cron Job 可订阅 OKX WS `wss://ws.okx.com:8443/ws/v5/public`，替代轮询
- Artifact 确认卡片：前端新增 `artifact:trade-confirm` 类型，渲染订单确认 UI，用户点击后回调 API
- 测试环境：OKX 提供模拟盘 API（header `x-simulated-trading: 1`），开发阶段全程用模拟盘验证

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

### P1 — 浏览器自动化工具（✅ 已内置，状态修正）

**状态：** ✅ 已通过 `web-access` Skill 实现（2026-04-19 核查）  
**原状态：** 📋 待实现（基于竞品分析的错误判断，现撤回）

**实际现状：**

`src-api/resources/skills/web-access/SKILL.md` 已实现 145 行完整的双层浏览器自动化策略：

- **静态层**：curl / `WebFetch` 工具，快速抓取静态 HTML 和 API 响应
- **动态层**：Chrome CDP（Chrome DevTools Protocol）代理，处理 JS 渲染页面、弹窗、登录墙
- **升级策略**：优先静态抓取；遇到 JS 渲染或认证墙时自动 escalate 到 CDP 控制真实 Chrome
- **额外能力**：截图（`Page.captureScreenshot`）、表单自动填写

覆盖目标数据源：上交所/深交所公告、东方财富研报中心、证监会政策文件、财联社等。

**结论：无需另行集成 Playwright。** `web-access` 已在金融数据抓取场景完整覆盖 Playwright 的核心能力。

---

### P2 — 多 Agent 编排层

**状态：** 📋 待实现  
**背景：** 来自竞品分析（OpenClaw 多 Agent 路由 + Hermes delegate_task，2026-04-19 代码核查修正）

**关键发现（2026-04-19 代码核查）：**

`@codeany/open-agent-sdk` 已内置完整的多 Agent 原语——`AgentTool`（子 Agent 派生）、`SendMessageTool`（Agent 间通信）、`TeamCreateTool/TeamDeleteTool`（团队管理）。HTclaw 的 `ALLOWED_TOOLS` 列表中尚未启用这些工具，这是主动选择而非能力缺失。**无需引入新 SDK 依赖**，工作量比原设计预期低。

**需要做的三件事：**

**① 开放 ALLOWED_TOOLS（1 行改动）**

在 `src-api/src/extensions/agent/codeany/index.ts` 的 `ALLOWED_TOOLS` 数组中添加：
```typescript
'Agent',       // AgentTool — 派生子 Agent
'SendMessage', // SendMessageTool — Agent 间通信
'TeamCreate',  // TeamCreateTool — 团队协作
'TeamDelete',  // TeamDeleteTool
```

**② 注册专项 Agent（新增配置文件）**

调用 SDK 的 `registerAgents()` 注册 4 个专项角色，每个 Agent 都有**严格的工具集限制**（参考 Hermes 设计：子 Agent 禁止写 memory、禁止直接 channel 推送、禁止与用户交互）：

```typescript
// src-api/src/extensions/agent/codeany/agents.ts（新增文件）
registerAgents({
  ResearchAgent: {
    description: '行情分析和投研报告专项 Agent',
    allowedTools: ['WebSearch', 'WebFetch', 'Skill', 'Read', 'Glob'],
    // 禁止：Write, CronCreate, TodoWrite, channel 推送类 Skill
  },
  ScreenerAgent: {
    description: '多维选股筛选专项 Agent',
    allowedTools: ['Skill', 'Read'],
    // 只允许 westock-screener 类技能
  },
  TradeAgent: {
    description: '交易执行 Agent（高安全级别）',
    allowedTools: ['Skill', 'Read'],
    // 严格限制：只能提案，结果返回父 Agent 等待用户确认
    // 禁止：Bash, Write, 任何 channel 推送
  },
  NotifyAgent: {
    description: '推送格式化和渠道发送专项 Agent',
    allowedTools: ['Skill', 'Read'],
    // 只允许 feishu/wechat channel 类 Skill
  },
})
```

**③ 任务路由 Planner（system prompt 扩展）**

在主 Agent system prompt 中增加意图分发规则段落，引导主 Agent 对复杂任务使用 `AgentTool` 并行派发：

```
当任务需要同时分析多个市场（A 股 + 加密）时，并行派发 ResearchAgent
当任务涉及选股筛选时，派发 ScreenerAgent
当任务涉及下单执行时，派发 TradeAgent，结果必须返回用户确认
当任务需要格式化推送时，最后串行调用 NotifyAgent
```

**实现文件规划：**
- `src-api/src/extensions/agent/codeany/index.ts` — `ALLOWED_TOOLS` 添加 Agent/SendMessage/TeamCreate/TeamDelete
- `src-api/src/extensions/agent/codeany/agents.ts` — 专项 Agent 角色定义和注册
- `src-api/src/config/prompt-loader.ts` — system prompt 增加多 Agent 路由规则段落

**实现顺序建议：**
1. 先开放 `AgentTool`，在现有 ALLOWED_TOOLS 中添加 `'Agent'`，验证 SDK 子 Agent 的实际行为
2. 注册 `ResearchAgent`（最高频场景：并行拉取 A 股 + 加密行情），实测延迟收益
3. 确认 40–60% 延迟改善可复现后，逐步扩展 ScreenerAgent / NotifyAgent
4. `TradeAgent` 最后实现（依赖 OKX 交易集成 P1 完成）

**依赖关系：**
- `TradeAgent` 依赖 OKX 全链路交易集成（P1）完成后才有意义

---

### P2 — 移动端轻量伴侣 App

**状态：** 📋 待实现  
**背景：** 来自竞品分析（OpenClaw 三端伴侣 App，2026-04-19）

**问题：** HTclaw 目前只有桌面端，用户无法在移动设备上主动发起任务或接收实时推送（Feishu/WeChat 的推送依赖桌面后台运行）。

**最小可行方案（MVP）：**
- 微信小程序 或 飞书小程序
- 功能：接收 HTclaw 推送的分析报告、语音输入发起分析任务、查看持仓概览（OKX）
- 技术：小程序前端 + 通过 htclaw-api 的云端中转（需要一个轻量云服务层）

**依赖前置：**
- 多模型支持（P0）：移动端网络不稳定，需要国内 provider 备选
- OKX 集成（P1）：移动端主要使用场景之一是查看持仓

---

### P2 — 更多可视化组件（F27）
**状态：** 待实现

- 饼图（行业/板块分布）
- 热力图（市场概览）
- 雷达图（多维选股评分）

---

### P3 — agentskills.io 技能生态兼容

**状态：** 📋 待实现  
**背景：** 来自竞品分析（Hermes Agent 技能生态，2026-04-19）

**价值：** 兼容 agentskills.io 开放技能市场规范，可以直接复用社区贡献的通用技能（网页爬虫、翻译、代码生成、数据处理……），避免 HTclaw 团队重复开发已有的通用能力。

**实现方式：** 在 `registerFilesystemSkills()` 中增加对 agentskills.io SKILL.md 格式的解析兼容，以及从 agentskills.io registry 安装技能包的 CLI 命令。

---

### P3 — Cron 系统迭代方向

#### 3.1 前端设置面板 UI ✅ 已完成
- 定时任务列表（展示 job 名称、schedule、最近运行状态）
- 创建表单：名称 + prompt 文本框 + schedule 选择器（预设网格 or 自定义 cron）
- Jitter 配置（开关 + 秒数输入，防止整点堆积）
- 运行历史展开（最近 10 次 startedAt / status / output 摘要）
- 启用/禁用切换开关

#### 3.2 Agent Cron Tool ✅ 已完成
让 Agent 可以通过自然语言创建/管理 Job：
```
用户：每天早上 9 点给我发一个市场早报
Agent 调用：定时任务管理 skill → curl POST /cron/jobs
```
实现：在 `~/.htclaw/skills/定时任务管理/SKILL.md` 中添加技能指令，服务启动时通过 `registerFilesystemSkills()` 自动注册到 SDK。

#### 3.3 Channel Delivery 完善 ✅ 已完成
`pushToChannel()` 已实现真实推送（飞书适配器 + 指数退避重试），前端创建 Job 表单也已支持 `targetConversationId` 输入。

#### 3.4 一次性价格提醒任务 ✅ 基础设施就绪
- `delivery: 'channel'` + `deleteAfterRun: true` 框架已完整
- 用户可通过自然语言告诉 Agent 创建监控任务：「当茅台跌破1500提醒我」
- Agent 使用 `定时任务管理` skill 创建 `type=every, interval=300000` 的轮询任务

---

## 技术债 🔧

（暂无）

---

## 附录：竞品对比摘要

> 详细分析见 `docs/competitive-analysis.md`

| 维度 | OpenClaw | Hermes Agent | HTclaw |
|------|----------|--------------|--------|
| 定位 | 全渠道消息网关 | 自主学习通用 Agent | 金融垂直桌面助手 |
| 最大优势 | 平台覆盖广、多端伴侣 | 自学习闭环、模型无关 | A股领域深度、中国渠道 |
| 最大短板 | 无领域深度、无记忆 | 无桌面体验、配置复杂 | 多模型配置 UX 待完善、无自学习 |
| 核心用户 | 企业内部机器人 | 开发者/研究者 | 中国个人投资者 |

**HTclaw 当前差距最大的两点（按优先级）：**
1. **多模型支持** — 绑定 Claude 是最大的可用性障碍（国内访问难、成本高）
2. **技能自学习** — Hermes Agent 的闭环学习让 Agent 越用越聪明，是长期竞争力的关键
