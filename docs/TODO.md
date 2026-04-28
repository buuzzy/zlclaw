# Sage — TODO & Feature Roadmap

> 只保留进行中和待实现的条目。已完成的功能通过 git commit 历史追溯。
> 最后更新：2026-04-28（v1.0.32 品牌更名 + Logo 更新 + 数据源清理）

---

## 进行中 🚧

### P1 — MiniMax 不采信 SKILL.md 的 artifact 选择规则

**发现于**：v1.0.3-rc1 验收（2026-04-25）

**现象**：用户问当日分时请求，agent 输出 *"系统目前没有分时图专用组件"*，而非走 `intraday-chart` artifact 渲染图表。

**真正根因**：MiniMax-M2.7-highspeed 模型不严格遵循 system prompt 里的 artifact 选择规则（模型 reasoning 跳过 SKILL.md 检索）。

**候选修复方向**：
1. 将关键 artifact 类型表从 SKILL.md 提到 system prompt 顶层
2. 加 few-shot 例子
3. 加 artifact-type 后置 guard
4. 换模型/试 GLM/Kimi 看遵循度

---

### P1 — 数据源迁移：westock API → TinyShare

**状态：** 📋 待启动（等接口文档 + MCP 到位后开始）

**涉及范围**：4 个 westock-* 技能、PostToolUse 拦截逻辑、前端 artifact 映射、API 文档。

**待用户提供**：
- [ ] TinyShare 接口文档
- [ ] TinyShare MCP server 配置

---

### P2 — iOS 移动端（Demo → 正式）

**状态：** Phase 0 完成，待 UI 适配
**详细文档：** [`docs/ios/IOS_PLAN.md`](./ios/IOS_PLAN.md)

| Phase | 内容 | 工作量 |
|-------|------|--------|
| Phase 0 | ✅ 最小 Demo：sage-api 上 Railway + Capacitor WebView + 邮箱登录 | 已完成 |
| Phase 1 | iOS UI 适配：底部导航、Safe Area、虚拟键盘、图表触摸 | 3-5 天 |
| Phase 2 | 数据层：SQLite→Supabase、文件系统、Deep Link/OAuth | 3-5 天 |
| Phase 3 | App Store 上架准备 | 1-2 天 |

---

### P2 — 意图识别驱动的执行策略分层

三层策略：直接执行（简单查询）→ 静默 plan（多步无歧义）→ 显式 plan+确认（有副作用/高成本）。
混合方案：规则层先拦 90%，拦不住的走 LLM 分类。涉及 `useAgent.ts` 路由 + 后端 plan 逻辑。

---

### P3 — 恢复 Windows x64 发布

WiX MSI 对非 ASCII 产品名有 encoding bug（已更名 Sage，此问题可能已自动解决）。给 Windows job 加 `--bundles nsis` 即可恢复。模板见 `docs/RELEASE.md` 附录 E。

---

## 待修复 🐛

### P2 — 分时图组件数据质量问题

分时图频繁出现数据不全（价格线只渲染前半段，成交量柱零星）。

| 方案 | 描述 | 推荐 |
|------|------|------|
| A. 轻量化 | 只请求 time + price，移除 volume | ⭐ 先试 |
| B. 删除组件 | `intraday-chart` 下线 | 备选 |
| C. 后端直出 | 后端直接格式化数据 | 改动大 |

---

### P2 — Artifact 组件空壳先行渲染

用户查询行情时，quote-card 先以空壳状态出现（无数据卡片框架），随后数据填充。预期应同时出现。

**关键文件**：`artifactParser.ts`、`ArtifactRenderer.tsx`、`useAgent.ts` processStream

---

### P2 — 导出图片截断（底部黑边）

`html-to-image` 截取的是可视视口而非完整内容，滚动区下方消息未渲染进截图。

**修复思路**：临时 expand 滚动容器到全量高度再截图 + 显式 `backgroundColor: '#ffffff'`。

---

### P3 — iwencai API key 改为从 env 读取

`constants.ts` 硬编码 `DEFAULT_IWENCAI_API_KEY`，最佳实践应改为纯环境变量读取。无实际安全风险，纯工程卫生。

---

## 待实现 📋

### P2 — 更新按钮展示下载进度

当前下载态只有 Loader2 旋转，DMG 250MB 下载时用户焦虑。数据链已存在（`state.progress`），只需 SVG 环形进度条消费它。

---

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
| 打包体积优化（按需下载 skills） | P2 | DMG 瘦身到 50~80MB |
| Supabase L2→L3（本地 Docker） | P2 | schema as code + 独立 dev 环境 |
| OAuth 回调页优化 | P3 | 浏览器 tab 残留问题 |
| 数据导入功能补齐 | P3 | 当前只导出可用，导入已禁用 |
| 账号注销 | P3 | 正式版实现 |
| 启动加载 UX 优化 | P3 | Logo 动画 + 阶段提示 |
| 隐私政策与 TOS 页面 | P3 | 正式版上架前做 |

---

## 遗留技术债务

- [ ] `message_count` 数字偏大：useAgent.ts 流式输出写入多条中间态消息，待重构收敛
- [ ] `full_transcript` 中 text 有 content=null 条目：同上根因
- [ ] `tool_input` 没截断上限：超长 payload 可能撑大 JSONB
- [ ] dev 与 release 的 `sage://` deep link 冲突：dev 模式 OAuth 回调被 release .app 拦截
