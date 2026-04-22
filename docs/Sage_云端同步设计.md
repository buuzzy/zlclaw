# Sage 云端同步设计文档

> 版本：v0.1（初稿）
> 最后更新：2026-04-21
> 配套迁移：`supabase/migrations/20260421094214_init_user_system.sql`

---

## 0. 基本原则（Local-first）

1. **本地始终是真相源**。所有完整数据（消息体、artifacts、API Key、skills 缓存）永远落在 `~/.sage/` 本地文件系统，离线可用。
2. **云端只存元数据**。Supabase 只保存登录必需信息、轻量索引、偏好备份、错误日志。**不存**敏感密钥、不存消息全文、不存用户生成的 artifact 文件。
3. **冲突策略**：`updated_at` 最新者覆盖对方（Last-Write-Wins）。对于 settings 这种 JSONB，支持 per-field LWW（未来扩展）。
4. **离线优先**：所有云同步都是 fire-and-forget，失败不阻塞用户操作，进入本地重试队列。
5. **可选启用**：未登录状态下 app 完全可用（保持 Sage 的 local-first 定位）。登录是"多设备 + 云备份"的增量价值。

---

## 1. 现状盘点

### 1.1 已有资产

- ✅ Supabase 项目：`wymqgwtagpsjuonsclye`
- ✅ OAuth：GitHub、Google 均已跑通 PKCE + deep link 流程
- ✅ 四张云端表已创建（见 migration），RLS 全部启用
- ✅ `handle_new_user` trigger：新用户登录时自动在 `public.profiles` 建档

### 1.2 表结构

| 表 | 主键 | 角色 |
|---|---|---|
| `profiles` | `id = auth.users.id` | 用户档案（display_name、avatar_url、app_version、platform） |
| `sessions` | `id TEXT` | 会话元数据（title、preview、message_count、has_artifacts） |
| `user_settings` | `id UUID` + `user_id UNIQUE` | 偏好备份（JSONB） |
| `error_logs` | `id UUID` | 错误上报（允许匿名） |

### 1.3 还没接上的

- ❌ 前端除了 `supabase.auth.*` 之外**没有一处**调用 `supabase.from(...)`
- ❌ 本地 `sessions` 表（SQLite）不知道云端存在
- ❌ 本地 `settings` 不知道云端存在
- ❌ 错误没有上报通道
- ❌ Sidebar 直接读 `user_metadata`，绕过 profiles 表
- ❌ 退出登录没清理云端 subscription

---

## 2. 整体架构

```
┌────────────────────────────────────────────────────────────────┐
│                       Sage Desktop App                         │
│                                                                │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │   UI (React) │     │ Sync Service │     │  API Sidecar │    │
│  │              │◀───▶│   (renderer) │     │  (local HTTP)│    │
│  └──────────────┘     └──────┬───────┘     └──────┬───────┘    │
│                              │                    │            │
│                              ▼                    ▼            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Local Storage (~/.sage/ + SQLite)             │  │
│  │  • sessions/*.json  • memory/*.md   • skills/  • mcp.json│  │
│  │  • sage.db (tasks, messages, files, settings)            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                 │
│                              │ Sync                            │
│                              ▼                                 │
│                     ┌────────────────────┐                     │
│                     │ Supabase (云端)    │                     │
│                     │ • profiles         │                     │
│                     │ • sessions (元)    │                     │
│                     │ • user_settings    │                     │
│                     │ • error_logs       │                     │
│                     └────────────────────┘                     │
└────────────────────────────────────────────────────────────────┘
```

**Sync Service** 是一个新增的前端模块（`src/shared/sync/`），负责：
- 监听本地 store 变化 → 推送到云
- 订阅云端 realtime 变化 → 合并到本地
- 维护离线队列（网络不可用时本地落盘，恢复后重放）
- 暴露 `SyncStatus` 给 UI（未同步 / 同步中 / 已同步 / 同步失败）

---

## 3. 同步模块分解

### 3.1 Profile 同步（P0）

**读取路径**（替换 sidebar 当前逻辑）：

```
登录成功 → 触发 syncProfile()
  ├─ SELECT * FROM profiles WHERE id = auth.uid()  → 云端值
  ├─ 对比本地缓存（optional localStorage）
  ├─ 云端 > 本地 → 更新本地、通知 UI
  └─ 本地 > 云端 → UPSERT 到云端
```

**Sidebar 读取优先级**：
```
profiles.display_name → user_metadata.full_name → user_metadata.name → "Guest User"
profiles.avatar_url   → user_metadata.avatar_url → user_metadata.picture → null
```

**修改路径**：
Settings 面板改 display_name / avatar → 先写本地（optimistic update）→ UPSERT 到 `public.profiles` → 同步给 `supabase.auth.updateUser({ data: { full_name } })`（可选，让 user_metadata 也保持一致）。

**字段**：`display_name`、`avatar_url`、`app_version`（自动）、`platform`（自动）。

---

### 3.2 Session 元数据同步（P1）

**写入时机**：本地 session 任何修改时
- 新建 session → INSERT
- 追加消息 → 更新 `message_count`、`preview`、`updated_at`
- Artifact 产生 → 更新 `has_artifacts = true`
- 删除 session → DELETE

**批量推送**（防抖）：本地改动合并为 300ms 内的一次 upsert batch。

**拉取时机**：
- 用户登录后首次
- Sidebar 手动刷新
- 可选：Supabase Realtime 订阅（`postgres_changes` on `sessions`）实时推送

**合并策略**：
```
forEach 云端 session not in 本地:
  本地 INSERT（标记 origin=cloud，暂无消息体）
  点击会话时再懒加载消息体？→ 需要额外存储机制（见 3.6）

forEach 本地 session not in 云端 but local.updated_at > cloud_fetch_time:
  云端 UPSERT

冲突（同 id 两边都有）:
  updated_at 大的赢
```

**跨设备消息体问题**：目前 `sessions` 只存元数据，消息体仅在创建设备上。跨设备登录能看到会话列表但点进去没有历史。**第一阶段接受这个限制**，在 UI 上明确提示"此会话在其他设备，点击同步完整内容"（暂不实现，见 3.6）。

---

### 3.3 User Settings 同步（P1）

**上云字段**（白名单制，避免误同步敏感内容）：
```json
{
  "theme": "dark",
  "language": "zh-CN",
  "defaultModel": "MiniMax-M1",
  "defaultProvider": "minimax",
  "enabledSkills": ["行情数据查询", ...],
  "sidebarCollapsed": false,
  "chatInputHeight": 120,
  // 其他 UI 偏好
}
```

**不上云**（黑名单）：
- ❌ API Keys（Anthropic / OpenAI / MiniMax / Moonshot / 自建 Channel 密钥）
- ❌ `profile.nickname/avatar`（走 3.1 的 profiles 表）
- ❌ MCP 服务器配置（可能含密钥）
- ❌ Cron Jobs（含任务上下文，较复杂，后续考虑）

**策略**：首次登录 MERGE（云端字段覆盖本地同名字段，本地独有字段保留）；之后本地改动立即 upsert（debounce 1s）。

---

### 3.4 Error Logs 上报（P2）

**触发点**：
1. Global `window.onerror` + `unhandledrejection`
2. React Error Boundary（`src/components/error-boundary.tsx`，需新建）
3. API 调用 wrapper：`fetch`/`axios` 错误拦截
4. Agent skill 执行失败（Rust 侧？还是 API sidecar？）

**采样策略**：
- Dev build：所有错误上报
- Release：critical errors 100%，一般 errors 采样 30%（避免洪水）

**字段填充**：
- `user_id` — 当前 session.user.id，或 null（匿名）
- `error_type` — `api_error` / `skill_error` / `crash` / `network_error` / `render_error`
- `message` + `stack_trace`
- `context` — JSONB，任何有帮助的上下文
- `app_version` — `__APP_VERSION__`（Vite define）
- `platform` — `navigator.userAgent` 解析，或 `@tauri-apps/api/os`
- `os_version` — `@tauri-apps/api/os`

**离线队列**：无网络时写入 `localStorage['sage:error-queue']`，恢复后清空。

---

### 3.5 Sign-Out 清理

当前 `signOut()` 只调用 `supabase.auth.signOut()`。需要扩展：
- 停止所有 realtime subscription
- 清空前端 React state（user、session、status）
- 可选：清本地 SQLite 里的**非用户数据**？**不要**——保持 local-first，用户再次登录时本地数据还在。
- 登录页自动跳走（✅ 已做）

---

### 3.6 [预留] 跨设备完整消息同步（P3，不在本次范围）

未来考虑用 Supabase Storage 存加密的 session messages blob。流程：
- 设备 A 每次 session 更新 → 压缩 JSON + 客户端对称加密（用户 passphrase 派生） → 上传 `storage/messages/{sessionId}.json.enc`
- 设备 B 登录 → 拉取 blob → 解密 → 写入本地

**先不做**，太复杂且非 MVP 需求。

---

## 4. 前端代码组织

新增目录结构：

```
src/shared/sync/
├── index.ts              # 导出 SyncProvider 和各 hook
├── sync-provider.tsx     # 顶层 Context，协调各子模块
├── profile-sync.ts       # 3.1 profile 同步
├── session-sync.ts       # 3.2 session 同步
├── settings-sync.ts      # 3.3 settings 同步
├── error-reporter.ts     # 3.4 错误上报
├── queue.ts              # 离线队列（localStorage-backed）
└── types.ts              # 同步状态类型定义
```

**集成位置**：
- `main.tsx` — `<SyncProvider>` 包裹在 `<AuthProvider>` 内部
- `left-sidebar.tsx` — `useProfileSync()` 替代直接读 `user.user_metadata`
- `AccountSettings.tsx` — 改 display_name / avatar 时调 `updateProfile`
- 新建消息 / 新建会话 的 hook（`useAgent`、`useChannelSync`）— 触发 `sessionSync.markDirty(sessionId)`
- `settings-provider` 或 `useSettings` — 改任何偏好时触发 `settingsSync.push()`

---

## 5. 分阶段实施计划（TODO）

### Phase 1 — Profile 统一（1 天）

**目标**：Sidebar、Settings 都从 `public.profiles` 读写，取代当前直接读 `user_metadata`。

- [ ] 1.1 新建 `src/shared/sync/profile-sync.ts`
  - `fetchProfile(userId)` → SELECT
  - `upsertProfile(partial)` → UPSERT
  - `useProfile()` hook：暴露 `{ profile, isLoading, refresh, update }`
- [ ] 1.2 修改 `left-sidebar.tsx`：用 `useProfile()` 替换当前的 `user.user_metadata` 直读
- [ ] 1.3 修改 `AccountSettings.tsx`：改昵称/头像时调 `profileSync.update(...)`
- [ ] 1.4 验证 GitHub/Google 首次登录时 profile 自动创建（`handle_new_user` trigger）
- [ ] 1.5 验证退出再登录后 profile 不被覆盖（upsert 保留已有 display_name）

### Phase 2 — Settings 云备份（1 天）

**目标**：主题、语言、enabledSkills 等非敏感偏好上云。

- [ ] 2.1 定义白名单 `SYNCABLE_SETTINGS_KEYS`
- [ ] 2.2 新建 `src/shared/sync/settings-sync.ts`
  - `fetchSettings()`、`pushSettings(partial)`
  - Debounce 1s 合并连续写入
- [ ] 2.3 登录时 merge：云端覆盖本地同名字段
- [ ] 2.4 本地 setSettings → 自动 push（过滤掉敏感字段）
- [ ] 2.5 退出登录时**不**清本地 settings（避免再次登录配置丢失错觉）

### Phase 3 — Session 元数据同步（2 天）

**目标**：任何设备登录都能看到会话列表。

- [ ] 3.1 新建 `src/shared/sync/session-sync.ts`
  - `syncSession(localSession)` → UPSERT 到云
  - `fetchCloudSessions()` → SELECT
  - `mergeToLocal(cloudSessions)` → 本地 SQLite 增量写入
- [ ] 3.2 在 `useAgent` 的 session 创建/更新链路加 hook 触发 syncSession
- [ ] 3.3 App 启动 + 登录成功后 fetchCloudSessions → mergeToLocal
- [ ] 3.4 Sidebar 显示 cloud-only session 的小标识（"点击下载完整内容" - 第三阶段不实现，先仅展示元数据 + title + preview）
- [ ] 3.5 删除 session 时也同步删云端

### Phase 4 — 错误上报（1 天）

- [ ] 4.1 新建 React Error Boundary（`src/components/error-boundary.tsx`）
- [ ] 4.2 新建 `src/shared/sync/error-reporter.ts`
  - `reportError(err, context)` 
  - 离线队列
  - 采样逻辑
- [ ] 4.3 `main.tsx` 注册 `window.onerror` + `unhandledrejection`
- [ ] 4.4 API fetch wrapper 失败时 reportError
- [ ] 4.5 Settings 面板提供"查看上报历史"（从 `error_logs` SELECT 本人）

### Phase 5 — Sync 状态 UI + Realtime（1 天，可选）

- [ ] 5.1 新建 `useSyncStatus()` hook 汇总各模块状态
- [ ] 5.2 Sidebar 底部显示同步指示器（绿点 / 旋转 / 红点）
- [ ] 5.3 接入 Supabase Realtime：订阅 `profiles` / `sessions` 的 `postgres_changes`，远端修改即时反映到本地
- [ ] 5.4 手动"立即同步"按钮

### Phase 6 — 浏览器回调页优化（P2，独立于同步）

见 TODO.md 对应条目，解决 OAuth 完成后浏览器 tab 停留问题。

---

## 6. 测试计划

### 登录/登出
- 新用户首次登录 → `profiles` 自动创建
- 老用户再次登录 → profile 不被覆盖
- 登出 → 本地数据保留

### 多设备
- 设备 A 登录 → 改昵称 → 设备 B 登录 → 看到新昵称
- 设备 A 创建会话 → 设备 B 能在 sidebar 看到元数据
- 设备 A 改主题 → 设备 B 登录同步

### 离线
- 断网状态改昵称 → 恢复网络后自动 push
- 断网创建会话 → 恢复后同步

### 错误边界
- 强制在 React 组件抛错 → Error Boundary 捕获并上报
- API 失败 → 上报 + 用户看到 toast

---

## 7. 开放问题

1. **session 全量消息的跨设备方案**：加密 blob 还是纯元数据？见 3.6。
2. **Cron Jobs 是否上云**：涉及任务上下文和执行结果，较复杂。先不做。
3. **Memory 系统（`~/.sage/memory/`）是否上云**：纯本地增量，目前看没必要。
4. **付费用户高级同步能力**：如果走商业化，可以把"完整消息云同步"作为付费功能。
5. **数据导出**：用户申请注销时 `DELETE FROM profiles WHERE id = auth.uid()` 级联清理，需要提供数据导出 API（`/api/export` 返回 JSON）。

---

## 8. 变更记录

| 日期 | 版本 | 作者 | 说明 |
|---|---|---|---|
| 2026-04-21 | v0.1 | Claude + Nakocai | 初稿，基于已有 migration 梳理同步方案 |
| 2026-04-21 | v0.2 | Claude + Nakocai | Phase 1 实施完成：sidebar + AccountSettings 接入云端 profile，验证跨设备同步生效。清理"未登录 fallback"死代码（产品设计必须登录）。 |
| 2026-04-21 | v0.3 | Claude + Nakocai | Phase 1 补丁：profile 本地缓存（按 user.id），消除重启/重登时的 ~500ms 昵称闪烁。 |
| 2026-04-21 | v0.4 | Claude + Nakocai | Phase 2 实施完成：新增 `settings-sync` + `settings-sync-provider`，白名单 16 个字段，debounced push，API Key 等敏感字段不上云。验证跨设备主题/语言/模型选择同步。 |
| 2026-04-21 | v0.5 | Claude + Nakocai | Phase 3 实施完成（最小闭环）：`session-dirty-queue` + `session-sync` + `session-sync-provider`，本地 session 变更单向上云，preview 改为"用户最后一问"语义。message_count 偏大问题归因到 Agent 层流式写入，留待重构。Feedback 上云合并到 Phase 4。 |
| 2026-04-22 | v0.6 | Claude + Nakocai | Phase 4 实施完成：`error-sync` + `error-boundary`，全局错误 listener + 离线队列 + 反馈排查上下文（默认摘要 + 可选完整对话）。验证反馈上云链路与排查能力充分。 |
| 2026-04-22 | v0.7 | Claude + Nakocai | Phase 5 实施完成（单机验收）：`sync-status` + `SyncStatusIndicator`，Profile/Settings 接入 Realtime 订阅。底层 sync 函数语义修正：失败抛出 Error 而非返回 null，解决断网仍显示"已同步"的误报。跨设备 Realtime 验收项记入 TODO。 |
