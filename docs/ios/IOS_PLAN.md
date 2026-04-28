# Sage iOS — 移动端方案设计

> 最后更新：2026-04-27

---

## 1. 背景与目标

将 Sage 金融助手扩展到 iOS 平台，发布 Demo 版供内测用户在手机上使用。
桌面端保持现有 Tauri + sidecar 架构不变，iOS 端共享同一套 React 前端代码。

---

## 2. 架构决策

### 2.1 为什么不能直接用 Tauri iOS

| 阻断项 | 原因 |
|--------|------|
| Node.js sidecar 无法运行 | iOS 禁止 fork/exec 子进程，`tauri-plugin-shell` sidecar 在 iOS 上不可用 |
| SQLite plugin 支持有限 | `tauri-plugin-sql` 在 iOS 上不完整 |
| OTA updater 不可用 | iOS 更新只能走 App Store / TestFlight |

### 2.2 选型结论

| 层 | 桌面端（不变） | iOS 端 |
|----|-------------|--------|
| 前端壳 | Tauri 2 (Rust) | **Capacitor** |
| 前端代码 | `src/` (React + Vite) | `src/`（共享） |
| 后端 | sage-api 本地 sidecar | sage-api **部署到 Railway** |
| 数据库 | 本地 SQLite + Supabase | Supabase（云端） |
| 认证 | Supabase Auth | Supabase Auth |

### 2.3 项目目录结构

```
sage/
├── src/                    ← React 前端（桌面 + iOS 共享）
├── src-api/                ← Hono 后端（桌面本地 / iOS 走 Railway）
├── src-tauri/              ← 桌面壳（Tauri, Rust）
├── ios/                    ← Capacitor 生成的 iOS 壳（Xcode 项目）
├── capacitor.config.ts     ← Capacitor 配置
├── docs/
│   └── ios/
│       └── IOS_PLAN.md     ← 本文件
```

---

## 3. 后端部署：Railway

### 3.1 为什么选 Railway

| 对比 | Railway | Render | Cloudflare Workers |
|------|---------|--------|--------------------|
| 运行模型 | 常驻容器 | 常驻容器（会休眠） | Serverless (V8 isolate) |
| 冷启动 | 无 | ~30 秒 | 无 |
| Node.js 支持 | 原生 | 原生 | 不支持（V8 only） |
| 执行时长限制 | 无 | 无 | 30 秒 |
| 文件系统 | 有（重启丢失） | 有（重启丢失） | 无 |
| 费用 | $5/月 Hobby Plan，含 $5 credit | 免费 750h（休眠恢复慢） | 免费但不兼容 |
| 预估月消耗 | $2-4 | $0 | N/A |

### 3.2 sage-api 部署改造清单

| 改造项 | 描述 | 工作量 |
|--------|------|--------|
| Dockerfile | 基于 `dist/bundle.cjs` 构建镜像，SKILL.md 等资源打包进镜像 | 0.5h |
| 鉴权 | TCP 回环检测 → JWT / API Key token 验证 | 2h |
| 文件持久化 | `~/.Sage/` 本地路径 → Supabase Storage 或内嵌到镜像（只读资源） | 2h |
| 环境变量 | Railway 控制台配置 API Key、Supabase 凭证等 | 0.5h |
| CI/CD | GitHub push → Railway 自动构建部署 | 0.5h |
| CORS | 允许 iOS WebView origin 跨域请求 | 0.5h |

### 3.3 运行时数据策略

| 数据类型 | 桌面端 | iOS/Railway |
|----------|--------|-------------|
| sessions | 本地 SQLite | Supabase Postgres |
| memory | 本地 `~/.Sage/memory/` | Supabase Storage / Postgres |
| skills config | 本地 `~/.Sage/skills/` | 打包进 Docker 镜像（只读） |
| cron jobs | 本地 `~/.Sage/cron/jobs.json` | Supabase Postgres + pg_cron |
| 用户配置 | 本地 SQLite + 云同步 | 纯 Supabase |

---

## 4. 前端改造：Capacitor 集成

### 4.1 Tauri API 替换清单

| 现有 Tauri API | 涉及文件 | Capacitor 替代 |
|---------------|----------|---------------|
| `@tauri-apps/plugin-sql` | `database.ts` | `@capacitor-community/sqlite` 或纯 Supabase |
| `@tauri-apps/plugin-fs` | `paths.ts`, `attachments.ts` | `@capacitor/filesystem` |
| `@tauri-apps/plugin-shell` | `lib.rs` (sidecar) | 不需要（后端在云端） |
| `@tauri-apps/plugin-deep-link` | `auth-provider.tsx` | `@capacitor/app` (appUrlOpen) |
| `@tauri-apps/plugin-updater` | `update-provider.tsx` | 移除（走 TestFlight） |
| `@tauri-apps/plugin-process` | `update-provider.tsx` | 移除 |
| `@tauri-apps/plugin-dialog` | 如有用到 | `@capacitor/dialog` |
| `@tauri-apps/plugin-opener` | `theme-provider.tsx` | `@capacitor/browser` |

### 4.2 平台差异处理

```typescript
// src/config/index.ts
const isTauri = '__TAURI_INTERNALS__' in window;
const isCapacitor = 'Capacitor' in window;

export const API_BASE_URL = isTauri
  ? `http://localhost:${API_PORT}`    // 桌面端：本地 sidecar
  : import.meta.env.VITE_API_URL;     // iOS 端：Railway 云端地址
```

### 4.3 需要适配的 UI/UX

| 项 | 桌面端 | iOS 端 |
|----|--------|--------|
| 导航 | Sidebar + 顶部拖拽栏 | 底部 Tab Bar / 汉堡菜单 |
| 安全区域 | 无 | Safe Area Inset（刘海 + 底部 Home Indicator） |
| 键盘 | 物理键盘 | 虚拟键盘弹出时输入框上移 |
| 图表交互 | 鼠标 hover + 十字光标 | 长按触发 tooltip |
| 字号 | 固定 | 需考虑 Dynamic Type |

---

## 5. 实施阶段

### Phase 0 — 验证可行性（Demo）
**目标**：最小可用 iOS 包，能跑通一次完整对话
**范围**：
- sage-api 部署到 Railway
- Capacitor 初始化 + 基础 WebView 包裹
- `API_BASE_URL` 指向 Railway
- 不做 UI 适配，纯 WebView 展示桌面版 UI
- TestFlight 分发

**工作量**：2-3 天

### Phase 1 — iOS UI 适配
- 底部导航 / 移动端布局
- Safe Area 适配
- 虚拟键盘交互
- 图表触摸手势

**工作量**：3-5 天

### Phase 2 — 数据层适配
- SQLite → 纯 Supabase（或 Capacitor SQLite）
- 文件系统 API 替换
- Deep Link / OAuth 回调适配
- 推送通知（可选）

**工作量**：3-5 天

### Phase 3 — 上架
- App Store 审核准备（隐私政策、TOS）
- 图标 / 启动画面
- App Store Connect 配置

**工作量**：1-2 天

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Railway $5/月 不够用 | 服务停机 | sage-api 轻量级，预估 $2-4/月；超出时升级或加实例 |
| `@codeany/open-agent-sdk` 在 Railway 行为不一致 | Agent 循环异常 | 跟桌面端同一份代码同一份 Node.js，风险极低 |
| ECharts 在 iOS WebView 性能差 | 图表卡顿 | lightweight-charts 作为备选；开启硬件加速 |
| App Store 审核被拒 | 延迟上架 | Phase 0 先走 TestFlight；同步准备隐私政策 |
