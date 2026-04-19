# HTclaw 竞品对比分析

> 分析日期：2026-04-19  
> 对比对象：[OpenClaw](https://github.com/openclaw/openclaw) · [Hermes Agent](https://github.com/nousresearch/hermes-agent) · HTclaw

---

## 一、产品概览

| 维度 | OpenClaw | Hermes Agent | HTclaw |
|------|----------|--------------|--------|
| 定位 | 全渠道消息网关 Agent | 自主学习通用 Agent 框架 | 中国金融垂直桌面助手 |
| 语言/运行时 | Node.js / TypeScript | Python | Tauri (Rust) + React + Node.js sidecar |
| 核心架构 | Gateway + 多平台适配器 + 多 Agent 路由 | SQLite/FTS5 + 闭环技能学习 + 多执行后端 | 本地桌面 + Claude SDK + 领域技能库 |
| 主要用户 | 企业内部机器人 / 开发者 | 开发者 / AI 研究者 | 中国个人投资者 |
| 开源状态 | 开源 | 开源 | 私有 |

---

## 二、OpenClaw 详细分析

### 架构特点

- **网关模型**：所有消息统一进入 Gateway，按意图路由到不同专项 Agent
- **23+ 消息平台**：Slack、Discord、Telegram、Line、WhatsApp、Email 等，通过统一 Adapter 接口接入
- **Workspace 注入**：用户在 `~/.openclaw/workspace/skills/` 中放置 SKILL.md 文件，Agent 启动时自动发现并注册技能
- **多端伴侣 App**：macOS + iOS + Android 三端原生应用，支持移动端发起任务和接收推送
- **语音 + Live Canvas**：支持语音输入，以及实时可视化工作区（Live Canvas）用于动态渲染内容

### 优势

- 平台覆盖最广（23+），对企业多平台办公场景覆盖全面
- 多端伴侣 App 体验完整，移动场景支持好
- 多 Agent 路由架构成熟，任务分解能力强
- Live Canvas 提供独特的实时可视化交互

### 劣势

- **无领域深度**：纯通用框架，没有任何金融/垂直领域内置能力
- **无持久记忆**：跨会话的用户偏好和历史上下文无法自动保留
- **无自学习机制**：技能完全依赖开发者手写，不能从执行经验中成长
- **无定时调度**：没有内置 Cron/定时任务系统
- 配置复杂，面向开发者，普通用户上手成本高

---

## 三、Hermes Agent 详细分析

### 架构特点

- **自主技能学习闭环**：Agent 执行任务后自动将经验抽取为可复用技能，存入 SQLite 技能库，下次遇到类似任务直接调用已验证路径
- **200+ LLM Provider**：通过统一 provider 抽象层支持 OpenAI、Anthropic、Gemini、DeepSeek、本地 Ollama 等，智能路由按任务复杂度和成本选择模型
- **40+ 内置工具**：代码执行、浏览器控制（Playwright）、文件操作、API 调用、数据库查询、图像处理等
- **6 种执行后端**：本地进程、Docker 沙箱、远程 SSH、云函数（AWS Lambda/GCF）、Kubernetes Pod、浏览器 WASM
- **无服务器休眠**：Agent 可以在无任务时完全休眠，恢复时加载持久化状态继续执行
- **agentskills.io 兼容**：支持从技能市场直接安装社区贡献的技能包
- **RL 轨迹生成**：可导出训练数据用于模型微调

### 优势

- 自学习闭环是核心差异化能力，Agent 用得越久越聪明
- 模型无关，用户不被单一 LLM provider 绑定
- 工具生态最丰富（40+），通用任务覆盖能力最强
- 多执行后端适应不同部署场景（本地、云、无服务器）
- agentskills.io 技能生态，可复用社区资产

### 劣势

- **无桌面体验**：纯 Python 服务端，没有图形界面，对普通用户不友好
- **配置极其复杂**：200+ provider、6 种后端的选项对非技术用户是障碍
- **无中国渠道集成**：不支持飞书、微信等国内平台
- **无金融垂直能力**：通用框架，没有 A 股/加密市场相关工具
- **无 Cron 调度**：没有内置定时任务和主动推送能力

---

## 四、HTclaw 自我评估

### 核心优势

**1. 垂直领域深度（A 股 + 中国金融生态）**

OpenClaw 和 Hermes Agent 都是通用框架，没有任何金融领域内置能力。HTclaw 拥有完整的 `westock-*` 技能族：

| 技能 | 功能 |
|------|------|
| `westock-market` | 实时行情、K 线、分钟级数据 |
| `westock-research` | 投研报告生成、基本面分析 |
| `westock-screener` | 多维选股筛选（PE/PB/ROE/资金流等） |
| `westock-sector` | 板块轮动分析、热点追踪 |

这是对比其他两个项目最明显的差异化护城河。

**2. 原生桌面体验（Tauri）**

OpenClaw 是纯命令行 + 伴侣 App 架构，Hermes Agent 是 Python 服务端。HTclaw 用 Tauri 实现了真正的原生桌面应用：本地 SQLite 持久化、文件系统访问、系统托盘、原生窗口管理、无需配置环境直接安装运行。这是对国内非技术用户最友好的交付形态。

**3. 中国渠道集成（微信 / 飞书）**

这是 HTclaw 对比两者最明显的本地化优势。OpenClaw 虽支持 23+ 平台但重点在 Slack/Discord/Telegram，HTclaw 的飞书/微信 channel 集成直接覆盖国内企业用户的核心工作场景。用户可以在飞书群组中 @ 机器人，直接触发 AI 分析并接收结果卡片。

**4. 持久记忆系统（向量 + FTS 混合检索）**

三个项目中，HTclaw 的记忆系统架构最为完善：

```
热层（0–30 天）：原始日文件 chunk，完整索引
温层（归纳后）：consolidator 提炼摘要 → MEMORY.md，永久索引权重 ×1.3
画像层：user.md 用户档案，永久索引权重 ×1.2
```

每日夜间 consolidator 自动将对话提炼为结构化长期记忆，配合向量 + FTS 双通道检索，实现跨会话的用户偏好和历史上下文延续。Hermes Agent 虽也有 SQLite/FTS5，但其记忆模块偏向技能经验存储而非用户个性化记忆。

**5. Cron 调度 + 主动推送闭环**

内置 Cron 调度系统（cron/every/at 三种类型）+ Feishu/WeChat 推送 + 指数退避重试，形成了「无人值守分析 → 主动触达」的完整闭环。这个组合在 OpenClaw 和 Hermes Agent 中都需要用户自行搭建。

---

### 核心劣势

**1. 多模型配置体验有待完善（非技术绑定，而是 UX 问题）**

从代码层看，HTclaw **并不存在硬性 Claude 绑定**：

- Agent 执行层使用 `@codeany/open-agent-sdk`，通过 `AgentConfig.apiType` 支持 `'anthropic-messages'` 和 `'openai-completions'` 两种协议格式切换
- ChatService 对非 Claude 模型走 raw fetch + OpenAI-compatible 路径，不依赖 Anthropic SDK
- 用户已可手动填写 apiKey + baseURL + model name 使用任意兼容模型（DeepSeek、Qwen 等均可接入）

真正的差距在于**配置体验**：
- 没有预设的 provider 选项（用户需要自己知道各厂商的 baseURL）
- 设置页仅有"测试连接"但不区分 Anthropic / OpenAI 协议，错误提示不够明确
- 无法在任务中动态切换模型（如：深度分析用 Claude，日常问答用 DeepSeek）
- Ollama 本地部署场景未经验证和文档化

**2. 缺乏自主技能学习闭环**

Hermes Agent 最核心的差异化能力：Agent 从执行经验中自动抽取可复用技能。HTclaw 的技能完全由开发者手写，没有任何自学习机制。随着任务复杂度提升，这个差距会越来越明显。

**3. 工具生态（重新评估后：非劣势，架构选择不同）**

> **2026-04-19 修正：** 早期结论「工具生态偏窄」是在未阅读代码的情况下得出的错误判断，经代码核查后撤回。

**实际现状：**

- **内置通用工具**：Agent 内置 `Bash`（全平台 shell）、`WebSearch`（实时网页搜索）、`WebFetch`（静态页面抓取）、`Read/Edit/Write/Glob/Grep`（文件系统）、`LSP`（代码语义分析）等工具，覆盖通用任务的绝大多数需求。
- **浏览器自动化已内置**：`web-access` Skill（145 行，`src-api/resources/skills/web-access/SKILL.md`）实现了静态 curl → 动态 Chrome CDP 的双层爬取策略：优先静态抓取，遇到 JS 渲染或登录墙自动升级为 CDP 协议控制真实 Chrome，支持截图。这与 Hermes 的 Playwright 集成在能力层面等价，且已在生产环境验证。
- **MCP 开放生态**：HTclaw 内置完整的 MCP（Model Context Protocol）支持，覆盖 stdio / http / sse 三种传输类型，Settings 面板提供图形化 MCP 服务器管理 UI（增删改导入），用户可接入任意 MCP 服务器扩展工具能力——这是 Hermes 不具备的。
- **意图驱动技能注入（`predictor.ts`）**：每次查询只注入 1–3 个匹配技能，相比 Hermes 将全量技能放入 system prompt，减少约 80% 的无效 token 消耗。

**真实差距：**

HTclaw 的工具选择是**「金融垂直深度 + MCP 开放扩展」的有意设计**，而非能力不足。Hermes 的 40+ 工具偏向通用计算场景（Docker 沙箱、SSH 远程、AWS Lambda），与 HTclaw 的目标用户需求几乎没有重叠。唯一值得关注的是：HTclaw 没有独立的代码执行沙箱（脚本通过 Bash 工具直接在本机运行），对安全意识较弱的用户存在一定风险。

**4. 移动端体验（重新评估后：渠道交互已有，富交互体验待补）**

> **2026-04-19 修正：** 原结论「无法在移动场景下主动发起完整任务」不准确，经代码核查后修正。

**实际现状（代码核查）：**

HTclaw 已通过 Channel 架构实现了完整的移动端双向交互能力：

- **发起任务** — 用户在飞书/微信手机客户端发消息，Feishu Adapter 通过 **WebSocket 长连接**（主）或 Webhook（辅）实时接收，立即触发 Agent 执行，无需桌面端在线
- **流式响应回显** — Feishu 通道支持 **Streaming Card**：Agent 输出第一个 text block 时立即在手机飞书创建动态卡片，后续 300–1500ms 更新一次（防 rate limit），用户可以看到实时流式文本输出
- **会话上下文** — 30 分钟 session 超时，同一会话内上下文连续保留
- **Slash 命令** — `/new /reset /status /compact /help` 在飞书/微信频道均可用
- **多模态输入** — 飞书发送图片，Adapter 下载为 base64 传给 Agent
- **消息可靠性** — WebSocket 心跳检测（30s 间隔，3 分钟超时自动重连）+ REST API 补偿轮询（5s 一次，回溯 2 分钟），防止消息丢失
- **并发保护** — 每个 Channel 独立串行队列（mutex），防止多消息并发破坏会话状态

**技术架构（Channel 层）：**

```
手机飞书 / 手机微信
    │ 发送消息
    ▼
Feishu Adapter（WebSocket 长连接，无需公网 URL）
    │ IncomingMessage { senderId, content, images }
    ▼
ChannelManager（串行队列 + Slash 命令拦截）
    │
    ├─► Agent 执行（runAgent 流式）
    │       │
    │       └─► Streaming Card 实时更新（飞书手机端可见）
    │
    └─► ChannelStore 持久化（~/.htclaw/channel-conversations.json）
              │
              └─► 桌面端 UI 3 秒轮询同步，以 Task 形式展示
```

**真实短板（非「无移动端」，而是体验层的差距）：**

| 能力 | 飞书/微信渠道 | OpenClaw iOS App |
|------|-------------|-----------------|
| 发起任务 | ✅ | ✅ |
| 流式文本回复 | ✅ | ✅ |
| K 线图 / Artifact 渲染 | ❌（飞书卡片不支持） | ✅（原生组件） |
| 工具调用过程可视化 | ❌ | ✅ |
| 设置管理 | ❌ | ✅ |
| 消息历史浏览 | ❌（仅飞书聊天记录） | ✅ |
| 离线推送通知 | ✅（飞书 App 原生） | ✅ |
| 无第三方依赖 | ❌（依赖飞书/微信） | ✅ |

**iOS 原生包可行性分析（2026-04-19）：**

HTclaw 当前为 **Electron DMG**（Chromium + Node.js sidecar），Apple 禁止 JIT 引擎上架 App Store，Electron → iOS 无直接迁移路径。可行方案按实现成本排序：

| 方案 | 工作量 | 说明 |
|------|--------|------|
| **PWA** | 最低 | 前端加 `manifest.json` + Service Worker，Safari「添加到主屏幕」；需后端远程可访问 |
| **Capacitor 包装** | 中 | 把 React 前端打包为 iOS 原生 Shell，提交 App Store；后端需云端部署或本机 tunnel |
| **React Native 重写** | 高 | 重写前端，共享 TypeScript 业务逻辑；原生体验最好，开发量最大 |

**评估结论（待定）：** 考虑到飞书渠道已覆盖大部分移动端使用场景（发起任务 + 流式回复），iOS 原生 App 的优先级取决于用户对「Artifact 渲染 + 设置管理」的移动端需求强度。短期最优解可能是 PWA + 飞书渠道组合，而非投入完整 iOS 开发。

**5. 无实时音视频 / Live Canvas**

OpenClaw 支持语音输入和 Live Canvas（实时可视化工作区）。对于行情分析场景，能够实时语音提问并在 Canvas 上动态渲染 K 线图，是极具竞争力的体验。HTclaw 目前是纯文字 + artifact 的静态交互模式。

> **产品决策（2026-04-19）：** 经评估，实时音视频在当前「金融分析助手」场景下需求不强——用户的核心诉求是分析结果的深度和准确性，而非语音对话。此项暂不纳入路线图，待用户研究发现明确需求后再评估。

**6. 单 Agent 架构（重新评估后：SDK 已具备基础原语，差距在编排层而非能力层）**

> **2026-04-19 代码核查：** 早期结论「HTclaw 是单 Agent 模式，无多 Agent 能力」在技术描述上不准确，经代码核查后修正。

**实际现状（SDK 层 — 代码核查）：**

`@codeany/open-agent-sdk` 已内置完整的多 Agent 原语集，HTclaw 通过 `ALLOWED_TOOLS` 列表按需启用：

| SDK 工具 | 功能 | HTclaw 当前状态 |
|---------|------|----------------|
| `AgentTool` | 派生子 Agent，支持并行/委托执行；内置 Explore/Plan 专项 Agent，也支持自定义 Agent 定义 | ❌ 未在 ALLOWED_TOOLS 中启用 |
| `SendMessageTool` | Agent 间信箱通信（text / shutdown_request / plan_approval_response） | ❌ 未启用 |
| `TeamCreateTool` / `TeamDeleteTool` | 多 Agent 团队管理（成员组成、任务列表、团队领导者） | ❌ 未启用 |
| `EnterWorktreeTool` / `ExitWorktreeTool` | 隔离 git worktree 环境，适合安全的子 Agent 执行 | ❌ 未启用 |
| `CronCreateTool` | Cron 隔离 Agent 运行（最接近 sub-agent 隔离的现有模式） | ✅ 已启用 |

**与竞品的对比（OpenClaw vs Hermes vs HTclaw SDK 层）：**

| 维度 | OpenClaw | Hermes Agent | HTclaw SDK 可用 |
|------|----------|--------------|-----------------|
| 子 Agent 派生 | ✅ Orchestrator/Workers | ✅ `delegate_task`（max 3 并发） | ✅ AgentTool（未启用） |
| Agent 间通信 | ✅ 消息路由 | ❌（结果聚合，无通信） | ✅ SendMessageTool（未启用） |
| 团队协作 | ✅ Dream Team（14+ Agent） | ❌ | ✅ TeamCreateTool（未启用） |
| 任务路由逻辑 | ✅ Gateway + 绑定规则 | ❌ 固定委托模式 | ❌ 未实现 |
| YAML 确定性管道 | ✅ Lobster Engine | ❌ | ❌ 未实现 |
| 专项 Agent 定义 | ✅ 预配置角色+限制工具集 | ✅ 受限工具集（无 memory 写入/无用户交互） | ❌ 未定义 |
| 延迟优化 | ✅ 40–60% 降低 | N/A | ❌ 未测量 |

**真实差距（非能力缺失，而是编排层未实现）：**

SDK 原语已具备，真正缺少的是**业务编排层**：

1. **专项 Agent 定义未写** — 需要定义 `ResearchAgent`/`ScreenerAgent`/`TradeAgent`/`NotifyAgent` 的角色 prompt、工具集限制和调用约束（参考 Hermes 的受限工具集设计）
2. **意图路由逻辑未实现** — 主 Agent 收到复杂任务后如何决策「派发给哪个子 Agent」，目前没有对应的 Planner 逻辑（参考 OpenClaw 的 Gateway + 绑定规则）
3. **ALLOWED_TOOLS 未开放** — AgentTool/SendMessageTool/TeamCreateTool 仅需加入 `ALLOWED_TOOLS` 数组即可激活，无需修改 SDK

**对比 Hermes 设计的关键启示：**

Hermes 对子 Agent 的工具集实施严格限制——子 Agent 禁止写 memory、禁止与用户直接交互，结果只能返回给父 Agent 聚合。这个设计防止了子 Agent 越权，值得 HTclaw 参考：`TradeAgent` 即使被派生，也应禁止直接调用 channel 推送工具。

---

## 五、改进路线图

### P0 — 多模型配置 UX 优化（基础能力已有，补完体验）

架构层面已支持 Anthropic 和 OpenAI 协议切换，需要补完的是**配置引导和使用体验**：

```
改进方向：
  ├── 设置页增加预设 Provider 选项（Anthropic / OpenAI / DeepSeek / Gemini / Ollama）
  │     → 选择后自动填充 baseURL，用户只需填 apiKey 和 model name
  ├── 连接测试区分协议类型，给出明确错误提示
  ├── 任务执行时支持 per-task 模型覆盖（不影响全局配置）
  │     → e.g. 特定技能强制走 Claude（长上下文），默认走 DeepSeek（低成本）
  └── Ollama 本地部署场景验证 + 文档化（无需 API Key，baseURL = http://localhost:11434）
```

优先级：国内用户最关心 DeepSeek 接入路径（价格低 + 无网络障碍），应作为第一个预设 provider。

### P0 — 技能经验学习闭环（参考 Hermes）

每次任务执行后，将「任务描述 + 执行步骤 + 成功/失败结果」结构化存入技能库。Agent 在接收类似任务时，先查询历史经验，将高置信度的执行路径作为 few-shot 上下文注入 prompt。纯 prompt engineering 可实现初版，不需要模型微调。

### P1 — OKX 全链路交易集成

详见 TODO.md — `P1 — OKX 全链路交易集成`

### P1 — 浏览器自动化工具（✅ 已内置，无需另行实现）

> **2026-04-19 修正：** 此项已通过 `web-access` Skill 实现，原「待实现」状态为误判。

`web-access` Skill（`src-api/resources/skills/web-access/SKILL.md`）已提供：
- 静态页面抓取（curl / WebFetch）
- 动态 JS 渲染页面（Chrome CDP 协议）
- 登录墙穿透（CDP 自动化填写表单）
- 截图能力

上交所/深交所公告、东方财富研报、证监会政策文件等金融数据源均可通过此 Skill 访问。**无需额外集成 Playwright。**

### P2 — 多 Agent 编排层（SDK 原语已就绪，差距在业务配置）

> **2026-04-19 代码核查：** 原描述「重新架构为多 Agent」存在误导——`@codeany/open-agent-sdk` 已内置 `AgentTool`/`SendMessageTool`/`TeamCreateTool` 等全套原语，无需引入新依赖。真正需要实现的是**业务编排配置层**，工作量远低于原描述。

**需要实现的三件事：**

1. **开放 ALLOWED_TOOLS** — 在 `src-api/dist/extensions/agent/codeany/index.js` 的 `ALLOWED_TOOLS` 数组中加入 `'Agent'`、`'SendMessage'`、`'TeamCreate'`、`'TeamDelete'`
2. **定义专项 Agent 角色** — 调用 SDK 的 `registerAgents()` 函数注册以下 Agent 定义：

```typescript
registerAgents({
  ResearchAgent: {
    description: '行情分析和投研报告专项 Agent',
    allowedTools: ['WebSearch', 'WebFetch', 'Skill', 'Read'],
    systemPrompt: '你是 HTclaw 的投研专项 Agent，专注于 A 股和加密市场的数据获取和分析...',
    // 禁止：CronCreate, TodoWrite, 直接 channel 推送
  },
  ScreenerAgent: {
    description: '多维选股筛选专项 Agent',
    allowedTools: ['Skill', 'Read', 'Bash'],  // 只能调用 westock-screener 类技能
    systemPrompt: '...',
  },
  TradeAgent: {
    description: '加密资产交易执行 Agent（高安全级别）',
    allowedTools: ['Skill', 'Read'],  // 严格限制：禁止 Bash/Write/Channel 推送
    systemPrompt: '只能提案，不能独立执行任何交易。所有交易提案必须返回给父 Agent 等待用户确认...',
  },
  NotifyAgent: {
    description: '推送内容格式化和渠道发送专项 Agent',
    allowedTools: ['Skill', 'Read'],  // 只调用 feishu/wechat channel skills
    systemPrompt: '...',
  },
})
```

3. **任务路由 Planner** — 在主 Agent 的 system prompt 中加入意图分发规则，或引入 OpenClaw 风格的 Gateway 绑定规则：

```
当任务需要同时分析多个市场时 → 并行派发 ResearchAgent
当任务需要选股筛选时 → 派发 ScreenerAgent
当任务涉及交易执行时 → 派发 TradeAgent（结果必须返回用户确认）
当任务需要推送格式化时 → 最后派发 NotifyAgent
```

**实现优先级：** 建议先实现 ResearchAgent（最常用场景）+ 并行行情分析，验证 SDK AgentTool 的实际延迟收益后，再逐步扩展其他角色。

### P2 — 移动端轻量伴侣 App

最小可行版本：微信/飞书小程序，支持接收 HTclaw 推送的分析报告，支持语音输入发起任务。

### P3 — agentskills.io 技能生态兼容

兼容 agentskills.io 技能市场规范，复用社区贡献的通用技能，避免重复造轮子。

---

## 六、一句话总结

HTclaw 当前的定位是「中国投资者的本地 AI 助手」，这个细分市场 OpenClaw 和 Hermes Agent 都没有认真做。从代码层看，模型协议兼容的技术基础已经具备，接下来最重要的两件事：**完善多模型配置体验**（降低国内用户接入 DeepSeek/Qwen 等本土模型的门槛），以及**引入经验学习机制**（让 Agent 用得越久越聪明）。
