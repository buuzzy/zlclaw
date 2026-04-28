# Sage — TODO & Feature Roadmap

> 只保留进行中和待实现的条目。已完成的功能通过 git commit 历史追溯。
> 最后更新：2026-04-28（v1.0.32 品牌更名 + Logo 更新 + 数据源清理）

---

## 进行中 🚧

### P2 — 意图识别驱动的执行策略分层

三层策略：直接执行（简单查询）→ 静默 plan（多步无歧义）→ 显式 plan+确认（有副作用/高成本）。
混合方案：规则层先拦 90%，拦不住的走 LLM 分类。涉及 `useAgent.ts` 路由 + 后端 plan 逻辑。

---

## 待修复 🐛

### P2 — 导出图片截断（底部黑边）

`html-to-image` 截取的是可视视口而非完整内容，滚动区下方消息未渲染进截图。

**修复思路**：临时 expand 滚动容器到全量高度再截图 + 显式 `backgroundColor: '#ffffff'`。

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

### 工程基建

| 条目 | 优先级 | 说明 |
|------|--------|------|
| Supabase L2→L3（本地 Docker） | P2 | schema as code + 独立 dev 环境 |
| OAuth 回调页优化 | P3 | 浏览器 tab 残留问题 |
| 数据导入功能补齐 | P3 | 当前只导出可用，导入已禁用 |
| 账号注销 | P3 | 正式版实现 |
| 启动加载 UX 优化 | P3 | Logo 动画 + 阶段提示 |
| iOS 移动端（Phase 1-3） | P3 | Phase 0 已完成，详见 `docs/ios/IOS_PLAN.md` |
| 数据源迁移 westock → TinyShare | P3 | westock 运行稳定，TinyShare 作为 fallback 容灾备选 |
| 隐私政策与 TOS 页面 | P3 | 正式版上架前做 |

---

## 遗留技术债务

- [ ] `message_count` 数字偏大：useAgent.ts 流式输出写入多条中间态消息，待重构收敛
- [ ] `full_transcript` 中 text 有 content=null 条目：同上根因
- [ ] `tool_input` 没截断上限：超长 payload 可能撑大 JSONB
- [ ] dev 与 release 的 `sage://` deep link 冲突：dev 模式 OAuth 回调被 release .app 拦截
