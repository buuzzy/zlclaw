# Sage — TODO & Feature Roadmap

> 只保留进行中和待实现的条目。已完成的功能通过 git commit 历史追溯。
> 最后更新：2026-04-29（v1.0.5）

---

## 待实现 📋

### P1 — OKX 全链路交易集成

加密资产方向：行情 → 分析 → 下单完整闭环。

| 阶段 | Skill | 说明 |
|------|-------|------|
| 第一阶段 | `okx-market` | 行情与数据（只读） |
| 第二阶段 | `okx-account` | 账户与持仓（只读，需 API Key） |
| 第三阶段 | `okx-trade` | 下单执行（含确认卡片） |

核心原则：AI 只负责计算和提案，执行权始终在用户手中。

---

### P1 — MiniMax artifact 选择规则

分时查询应走 `intraday-chart`，但 MiniMax 声称"没有分时图组件"。根因是 LLM reasoning 跳过 SKILL.md 检索。候选方案：提到 system prompt 顶层 / 加 few-shot / 后置 guard / 换模型。

---

### 工程基建

| 条目 | 优先级 | 说明 |
|------|--------|------|
| 数据导入功能补齐 | P3 | 当前只导出可用，导入已禁用 |
| 账号注销 | P3 | 正式版实现 |
| 启动加载 UX 优化 | P3 | Logo 动画 + 阶段提示 |
| iOS 移动端（Phase 1-3） | P3 | Phase 0 已完成，详见 `docs/ios/IOS_PLAN.md` |
| 隐私政策与 TOS 页面 | P3 | 正式版上架前做 |
| 恢复 Windows x64 发布 | P3 | 产品已更名 Sage（纯英文），WiX 编码 bug 不再阻碍，加 `--bundles nsis` 即可 |

---

## 待讨论 💬

> 参考 Hermes Agent / OpenClaw 分析提炼，逐项评估后再决定是否实施。

### 记忆冻结快照

**来源**: Hermes Agent 2.2.3

**现状**: Sage 每次 API 调用时动态构建 system prompt（注入记忆、技能列表等），内容可能随对话推进而变化。

**方案**: 在会话开始时冻结 system prompt 快照，整个会话内不再变化。后台可以更新记忆，但只在下一个会话生效。

**收益**: 提升 Anthropic/OpenAI 的 prompt prefix cache 命中率，减少 API 延迟和成本。

**工作量**: ~1 天。改 `buildSystemPrompt()` 逻辑，加会话级缓存。

---

### 会话搜索（FTS5）

**来源**: Hermes Agent 2.7

**现状**: Sage 的会话列表只能靠标题浏览，无法搜索历史对话内容。

**方案**: 在本地 SQLite 上建 FTS5 虚拟表，对 messages 表的 content 做全文索引。前端加搜索框，支持中文（trigram 分词器）。

**收益**: 用户能快速找到"上次问过茅台分析"等历史对话。

**工作量**: ~1 天。SQLite migration + FTS5 查询 + 前端搜索 UI。

---

### Token 用量追踪与费用预估

**来源**: Hermes Agent 4.2.3 / OpenClaw

**现状**: Sage 不追踪 token 消耗。用户不知道对话成本。

**方案**: 记录每次 API 调用的 `usage.prompt_tokens` / `completion_tokens`，按模型价格计算费用。设置面板展示"本月累计 token / 估算费用"。

**收益**: 用户对成本有感知，避免账单惊吓。可以设阈值提醒。

**工作量**: ~1-2 天。后端记录 usage + 前端展示。

---

### 上下文压缩保护头尾

**来源**: Hermes Agent 2.3

**现状**: Sage 的 compaction 由 Agent SDK 处理，压缩策略可能丢失最近对话上下文。

**方案**: 压缩时保护头部（system prompt + 首轮对话）和尾部（最近 N 轮），只压缩中间部分。

**收益**: 长对话场景下 agent 不会"忘记"最近讨论的内容。

**工作量**: ~1 天。需要深入 Agent SDK 的 compaction 逻辑。

---

### 错误分类器

**来源**: Hermes Agent 3.3.1 / OpenClaw 3.3.1

**现状**: Sage 的 API 错误处理是 ad-hoc 的（`formatFetchError` 按消息文本匹配）。

**方案**: 结构化错误分类（rate_limit / timeout / auth / context_overflow / server_error），每种类型对应不同重试策略和用户提示。

**收益**: 更精准的重试、更友好的错误提示、更好的日志可追踪性。

**工作量**: ~0.5 天。封装分类函数 + 调整重试逻辑。

---

### 技能渐进式披露

**来源**: Hermes Agent 2.6

**现状**: Sage 已实现 intent predictor（`predictor.ts`），每次请求只注册匹配的 ~5 个技能。但完整 SKILL.md 内容仍会注入 context。

**方案**: system prompt 只注入技能摘要列表（名称 + 一句话描述），agent 需要时通过 tool call 加载完整 SKILL.md。

**收益**: 进一步减少每次 API 调用的 token 消耗。

**工作量**: ~2 天。改 skill loader + system prompt 构建 + 新增 skill_view 工具。
