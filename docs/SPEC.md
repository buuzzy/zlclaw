# HTclaw — 技术规格文档（SPEC）

> 版本：v0.1  
> 更新日期：2026-04-19

---

## 一、系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri 桌面应用                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   React 前端（Vite + TSX）                │   │
│  │                                                          │   │
│  │   HomePage   TaskPage   SettingsModal   LeftSidebar      │   │
│  │       ↓          ↓           ↓              ↓           │   │
│  │              ChatInput / ChatMessage                     │   │
│  │                      ↓                                  │   │
│  │              useAgent (SSE 消费)                         │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │ HTTP / SSE                             │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │              htclaw-api sidecar（Hono / Node.js）         │   │
│  │                                                          │   │
│  │  AgentRouter  MemorySystem  CronScheduler  ChannelMgr    │   │
│  │       ↓            ↓             ↓             ↓        │   │
│  │   Claude SDK   SQLite/FTS   node-cron      飞书/微信     │   │
│  │   Skill Registry  Vector     REST API      Adapter       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              本地存储                                     │   │
│  │  ~/.htclaw/db/htclaw.db（SQLite）                        │   │
│  │  ~/.htclaw/memory/*.md（记忆文件）                        │   │
│  │  ~/.htclaw/cron/jobs.json（定时任务）                     │   │
│  │  ~/.htclaw/config.json（用户配置）                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 技术栈 | 职责 |
|------|--------|------|
| Tauri shell | Rust | 原生窗口、系统托盘、sidecar 进程管理 |
| React 前端 | React 18 + Vite + TypeScript | UI 渲染、SSE 消费、本地 SQLite 读写 |
| htclaw-api | Hono + Node.js 22 | Agent 执行、记忆系统、Cron、渠道集成 |
| Claude SDK | @anthropic-ai/claude-code | Agent 执行引擎、工具调用、技能路由 |
| SQLite (前端) | better-sqlite3 (via Tauri) | 任务、消息、会话的本地持久化 |
| SQLite (后端) | better-sqlite3 | 记忆 chunk、向量索引的持久化 |

---

## 二、前端规格

### 目录结构

```
src/
  ├── app/
  │   ├── pages/
  │   │   ├── Home.tsx          # 主页（新建任务入口）
  │   │   └── Task.tsx          # 任务执行页（对话视图）
  │   └── App.tsx               # 路由配置（React Router）
  ├── components/
  │   ├── layout/
  │   │   └── LeftSidebar/      # 左侧任务列表
  │   ├── shared/
  │   │   ├── ChatInput/        # 输入框组件
  │   │   └── ChatMessage/      # 消息渲染组件（含 artifact）
  │   └── settings/             # 设置面板
  ├── shared/
  │   ├── db/                   # 前端 SQLite CRUD
  │   ├── hooks/
  │   │   ├── useAgent.ts       # SSE 消费 + 消息状态管理
  │   │   └── useChannelSync.ts # 渠道对话同步到本地
  │   ├── lib/
  │   │   ├── background-tasks.ts
  │   │   └── session.ts
  │   └── providers/
  │       └── language-provider.tsx  # i18n
  └── config/
      └── locale/               # zh / en 翻译文件
```

### 关键数据流

**新建任务流程：**
```
用户输入 → handleSubmit
  → createSession (SQLite)
  → navigate /task/:taskId { prompt, sessionId, attachments, mode }
  → TaskPage 挂载
  → useAgent.startTask()
  → POST /agent/stream (SSE)
  → 逐 chunk 渲染消息
  → 任务完成 → 写入 SQLite
```

**渠道同步流程：**
```
useChannelSync (每 3s 轮询)
  → GET /channels/conversations/all
  → 对比本地 SQLite，差异写入
  → 指纹去重（role + content[:120]）
  → onNewTask() → loadTasks() → 刷新侧边栏
```

**删除任务防复活机制：**
```
handleDeleteTask(taskId)
  → markChannelTaskDeleted(taskId)   # localStorage 写入黑名单
  → deleteTask(taskId)               # 删除 SQLite 记录
  → DELETE /channels/conversations/:id  # 删除后端存储
  → 黑名单在下次 useChannelSync 中生效，阻止重建
  → 仅当后端不再返回该 ID 时，才从黑名单中移除
```

### Artifact 渲染类型

| type | 渲染组件 | 说明 |
|------|----------|------|
| `text` | 纯文本 | 普通对话回复 |
| `code` | 代码块（syntax highlight） | 代码生成 |
| `markdown` | Markdown 渲染 | 研报、分析报告 |
| `chart` | ECharts K 线/折线图 | 行情可视化 |
| `table` | 数据表格 | 选股结果、持仓列表 |
| `trade-confirm` | 订单确认卡片（规划中） | OKX 下单确认 UI |

---

## 三、后端 API 规格（htclaw-api）

### 基础信息

- 框架：Hono
- 运行时：Node.js 22
- 监听端口：通过 `~/.htclaw/config.json` 中 `port` 字段配置（默认 `3000`）
- 安全：管理类路由均经过 `localOnlyMiddleware`（仅允许 127.x / ::1 访问）

### Agent 端点

```
POST /agent/stream
  请求体：{ prompt, sessionId, taskId, attachments?, mode? }
  响应：Server-Sent Events (text/event-stream)
  事件类型：message | tool_call | tool_result | artifact | done | error
```

### 记忆系统端点

```
GET  /memory/status          # 向量索引状态（chunk 数、模型、最后索引时间）
POST /memory/index           # 重建向量索引
POST /memory/consolidate     # 手动触发记忆归纳
GET  /memory/search?q=       # 混合检索（debug 用）
```

### Cron 调度端点

```
GET    /cron/jobs            # 列出所有 Job
POST   /cron/jobs            # 创建 Job
GET    /cron/jobs/:id        # 查询单个 Job（含运行历史）
PUT    /cron/jobs/:id        # 更新 Job（enabled/prompt/schedule）
DELETE /cron/jobs/:id        # 删除 Job（系统 Job 不可删）
POST   /cron/jobs/:id/run    # 手动立即执行
```

#### Job 创建请求体

```typescript
interface AddJobInput {
  name: string;
  prompt: string;
  schedule: CronSchedule;
  enabled?: boolean;          // default: true
  deleteAfterRun?: boolean;   // 一次性任务
  jitter?: number;            // 执行抖动（毫秒），default: 30000
  targetConversationId?: string;  // 推送目标渠道会话 ID
}

type CronSchedule =
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'every'; interval: number }
  | { type: 'at'; at: string };   // ISO 8601
```

### 渠道集成端点

```
GET  /channels/conversations/all          # 获取所有渠道对话
GET  /channels/conversations/:id          # 获取单个渠道对话
DELETE /channels/conversations/:id        # 删除渠道对话（防止 useChannelSync 复活）

POST /channels/feishu/webhook             # 飞书消息 Webhook 入口
POST /channels/wechat/webhook             # 微信消息 Webhook 入口
```

### 设置端点

```
GET  /settings                # 获取当前配置
PUT  /settings                # 更新配置
POST /settings/test-connection # 测试 LLM 连接
```

---

## 四、记忆系统规格

### 三层架构

```
热层（Hot Layer）
  - 内容：原始日对话文件 ~./htclaw/memory/YYYY-MM-DD.md
  - 索引：完整向量 + FTS 索引
  - 生命周期：≤30 天，超期从索引中驱逐（磁盘保留）
  - 权重系数：1.0

温层（Warm Layer）
  - 内容：consolidator 提炼的结构化摘要 → ~/.htclaw/MEMORY.md
  - 索引：永久索引
  - 生命周期：永不删除
  - 权重系数：1.3

画像层（Profile Layer）
  - 内容：用户投资画像 ~/.htclaw/user.md
  - 索引：永久索引
  - 生命周期：永不删除
  - 权重系数：1.2
```

### 记忆写入规格

每轮对话（非 trivial，即 AI 回复 >50 字）追加到日文件：

```markdown
## HH:MM

**用户：** {user_message[:200]}

**助手：** {assistant_message[:300]}
```

### 混合检索规格

```
score = vector_similarity × 0.7 + keyword_score × 0.3
score_final = score × sourceWeight(source)

sourceWeight:
  MEMORY.md → 1.3
  user.md   → 1.2
  日文件    → 1.0

返回 top-5 结果注入 system prompt
```

### Consolidator 规格

- 触发方式：Cron Job（每天 23:00）或手动（`POST /memory/consolidate`）
- 幂等保护：处理完一个日期文件后写入 `.YYYY-MM-DD.consolidated` 标记
- 输出格式：

```markdown
## YYYY-MM-DD 每日归纳

### 讨论主题
...

### 关键结论
...

### 用户偏好与习惯
...

### 待跟进事项
...
```

---

## 五、技能系统规格

### 内置技能（src-api/resources/skills/）

| 技能 ID | 功能域 | 主要接口 |
|---------|--------|---------|
| `westock-market` | A 股行情 | 股票报价、K 线、分钟线、资金流 |
| `westock-research` | 投研分析 | 基本面分析、财报解读、研报生成 |
| `westock-screener` | 选股筛选 | 多维财务指标筛选 |
| `westock-sector` | 板块分析 | 板块轮动、热点追踪 |
| `定时任务管理` | Cron 管理 | 创建/查询/删除定时任务 |

### 用户自定义技能

用户在 `~/.htclaw/skills/<技能名>/SKILL.md` 中放置技能指令文件，服务启动时通过 `registerFilesystemSkills()` 自动发现并注册到 SDK。

SKILL.md 格式：

```markdown
# 技能名称

## 触发条件
描述 Agent 何时应该使用此技能

## 使用方法
具体的操作步骤和 curl 命令示例

## 注意事项
约束条件、权限说明等
```

---

## 六、数据库 Schema

### SQLite（前端 — htclaw.db）

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  favorite INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'user' | 'text' | 'tool_call' | 'tool_result' | 'artifact'
  content TEXT,
  metadata TEXT,       -- JSON，存储 artifact type、tool name 等额外信息
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

---

## 七、安全规格

### API Key 存储

- 存储位置：`~/.htclaw/config.json`（用户 home 目录）
- 访问权限：仅当前用户可读（chmod 600）
- 不提交到 git：`config.json` 在 `.gitignore` 中

### 本地 API 访问控制

`localOnlyMiddleware` 检查 TCP 连接的对端 IP：

```typescript
// 仅允许 loopback 地址
const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
if (!allowed.includes(clientIp)) {
  return c.json({ error: 'Forbidden' }, 403);
}
```

应用范围：`/memory/*`、`/cron/*`、`/settings/*`

### OKX 交易安全（规划中）

- `requireConfirmation: true` 不可通过配置关闭
- `allowedInstTypes` 默认仅 `['SPOT']`（禁止合约）
- `maxSingleOrderUSDT` / `maxDailyTradeUSDT` 双重限额
- 开发阶段全程使用 OKX 模拟盘（`x-simulated-trading: 1`）

---

## 八、构建与部署

### 开发环境

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前端 + API sidecar）
pnpm dev

# 启动 Tauri 开发模式
pnpm tauri dev
```

### 生产构建

```bash
# 构建前端 + API sidecar
pnpm build

# 构建 Tauri 安装包（macOS ARM）
./scripts/build.sh mac-arm

# 构建包含 Claude Code CLI 的完整包
./scripts/build.sh mac-arm --with-cli
```

### 构建产物

| 产物 | 路径 | 说明 |
|------|------|------|
| 前端 | `dist/` | Vite 构建输出 |
| API sidecar | `src-api/dist/htclaw-api` | 打包为单文件可执行 |
| Claude sidecar | `src-api/dist/claude` | Claude Code CLI |
| Codex sidecar | `src-api/dist/codex` | Codex CLI |
| CLI Bundle | `src-api/dist/cli-bundle/` | Node.js 运行时 + cli-wrapper.cjs |
| DMG | `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/` | macOS 安装包 |

### 版本号管理

版本号在 `src-tauri/tauri.conf.json` 中的 `version` 字段维护，构建时自动嵌入到产物文件名中。

当前版本：`0.1.0`
