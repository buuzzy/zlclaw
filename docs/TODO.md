# Sage — TODO & Feature Roadmap

> 只保留进行中和待实现的条目。已完成的功能通过 git commit 历史追溯。
> 最后更新：2026-04-29（v1.0.6）

---

## 已知问题 🐛

### K 线图组件偶现消失

**现象**：用户问"贵州茅台最近一个月日K线"，K 线图组件先正确渲染，但随后 Agent 继续 thinking 并输出纯文字分析，K 线图消失，最终只剩文字。

**复现率**：偶现（2026-04-29 测试中出现 1 次，后续多次测试未复现）

**根因分析**：
1. PostToolUse hook 拦截 API 响应，生成 `artifact:kline-chart` 并替换 tool_output 为 summary（`[数据已获取]...K线图已自动渲染，请基于上述数据撰写分析，不要输出artifact块`）
2. MiniMax 无视 summary 中的"不要输出 artifact 块"指令，自己又输出了一个 `artifact:kline-chart` + 纯文字分析
3. 前端收到两条消息：① 含 artifact 的消息 ② 纯文字分析消息。两条都正确渲染，但视觉上文字消息在后、K 线图滚出视口或被认为"消失"

**相关日志**：error_logs 表，message = "4月29日测试用例3"，完整 transcript 含 hook summary → 模型重复输出 artifact 的证据链

**候选修复方向**：
- A. 强化 summary 措辞（当前方案，已在 AGENTS.md 添加"任务完成规则"）
- B. PostToolUse hook 中检测模型是否重复输出 artifact 块，若检测到则 strip 掉
- C. 前端侧：确保 artifact 组件始终 sticky/置顶，不被后续文字消息推走
- D. 换用 instruction following 更强的模型

**当前状态**：观察中，已通过 AGENTS.md + maxTurns 限制降低发生概率

---

### MiniMax 输出残留 artifact 标题

**现象**：对比查询（如"对比茅台和五粮液走势"）中，PostToolUse hook 拦截数据并渲染了 K 线图，但 MiniMax 随后在文字分析之后又输出 `artifact:kline-chart` 块。前端提取 artifact 后，剩余的标题文字（如"贵州茅台（600519.SH）K线图"）孤立显示在页面底部。

**根因**：与上一条相同 — MiniMax 无视 summary 中"不要输出 artifact 块"的指令。

**相关日志**：error_logs 表，message = "4月29日测试用例7"

**当前状态**：观察中，归入上方 K 线图偶现问题统一处理

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

### P1 — 复杂多标的查询体验差

**现象**：如"分析沪深300、纳斯达克、恒生指数、日经225今年表现，给出对比"，Agent 需要大量工具调用（17-35步），经常触发 maxTurns/MAX_TOOL_CALLS 限制后截断，无法输出完整结论。

**已做的优化**：
- `isDirectExecuteQuery` 加了多标的检测（含"对比/分析" + 顿号枚举时不跳过 plan）
- `maxTurns: 12`，`MAX_TOOL_CALLS: 20`（仅日志，不 abort）
- AGENTS.md 添加了「任务完成规则」和「复杂查询上限 3-4 次工具调用」

**仍存在的问题**：
- iwencai 技能 401 导致 Agent 降级到 WebSearch，搜索效率低、调用次数多
- MiniMax 对"不要输出 artifact 块"指令遵从度低，输出冗余内容
- plan 阶段对 MiniMax 效果有限，生成的 plan 质量一般

**根本解决方向**：
- A. 修复 iwencai 401（已修复 X-Claw headers + 强制覆盖技能文件，待验证）
- B. 后端预处理：识别多标的查询，拆分为并行子任务（参考 AGENTS.md 子 Agent 规范）
- C. 换用 instruction following 更强的模型（Claude 等）
- D. 对 WebSearch 降级场景做专门优化（一次搜索多关键词）

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
