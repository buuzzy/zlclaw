# Privacy Policy / 隐私政策

**Last Updated: April 30, 2026**

## English

Sage ("the App") is developed by YIYANG CAI. This privacy policy explains how the App handles your information.

### Account Required

Sage is an online service designed as your "financial digital twin." To provide cross-device synchronization and memory continuity, **an account is required to use the App**. Authentication is handled by Supabase.

### Data We Store

To enable Sage's memory and cross-device features, we store the following on our cloud infrastructure (Supabase):

- **Account information**: email address (for account identification)
- **Conversation data**: chat history, sessions, tasks, files metadata
- **Curated profile**: a markdown summary automatically distilled from your conversations (see "Distilled Profile" below)
- **Your notes**: any free-form notes you write in Settings → Memory

We also keep a complete local copy of your conversation data on your device (SQLite for desktop, IndexedDB for iOS) for fast offline reading.

### Our Commitments on Data Use

Beyond storing your data to provide functionality, we make the following binding commitments:

1. **No analysis or secondary use**: Your conversation data will **not** be used for model training, advertising, or any other commercial purpose
2. **No third-party sharing**: We will not sell, trade, or share your conversation data with any third party except the technical service providers listed below
3. **You have full control**: You can clear all your conversation data and notes (cloud + local) at any time from Settings → Memory → Data Management. Your account is preserved unless you separately delete it
4. **Transparency**: You can view what Sage has distilled about you (the "Profile" section in Settings → Memory) at any time

### Distilled Profile

To make Sage feel like a true digital twin, the App periodically (nightly) runs an automated process that reads your recent conversations and distills them into a summary stored as `profile.content_md`. This summary helps Sage remember your preferences and context across conversations.

This distillation:
- Runs automatically on our cloud infrastructure (Railway)
- Uses third-party language models (see "Third-Party Services" below)
- Produces a markdown summary visible to you in Settings → Memory
- Does **not** produce data shared with anyone but you and Sage

### Third-Party Services

The App relies on the following third-party services:

| Service | Purpose | Data Sent |
|---------|---------|-----------|
| **Supabase** | Account auth + data storage | Account info, conversations, profile, notes (encrypted in transit and at rest) |
| **OpenAI / MiniMax / etc.** | AI model inference (chat responses + nightly profile distillation) | Conversation content (per their respective API terms; these providers do not retain your data) |
| **Financial data APIs** (iwencai, westock, etc.) | Real-time market data | Query parameters only (e.g., stock symbols); **no personal information** |

### Data Encryption

- **In transit**: All communications use HTTPS / TLS encryption
- **At rest**: Supabase encrypts stored data on disk by default
- **Access control**: Row-Level Security (RLS) policies in Supabase enforce that one user can never access another user's data
- **End-to-end encryption (E2EE)**: We do **not** offer E2EE. This is a deliberate trade-off — E2EE would prevent the cloud from running profile distillation and full-text search, both essential to Sage's value. Our infrastructure can technically read your data when necessary to provide service, but we commit (per above) not to use it for any purpose other than serving you.

### Backups

Supabase automatically maintains backups of our database for service reliability (Point-in-Time Recovery, typically 7 days on the Pro plan). When you clear your data, the live data is deleted immediately, and old backup snapshots are naturally rotated out within the backup retention window.

### Error Logs (Optional, User-Initiated)

When you choose to submit error logs from within Sage, we will analyze those logs to improve the product. **This is the only exception to the "no analysis" commitment above, and it only happens when you explicitly initiate it.**

### Data Deletion

You can clear your data through:

1. **In-app**: Settings → Memory → Data Management → "Clear All Conversations and Notes"
   - This permanently deletes your cloud + local conversation data, profile, and notes
   - Your account and settings are preserved
2. **Account deletion**: Contact us via GitHub issue. Account deletion is permanent and cannot be undone.

### Contact

If you have any questions about this privacy policy, please contact:

- GitHub: [https://github.com/buuzzy/sage](https://github.com/buuzzy/sage)
- Email: Open an issue on the GitHub repository

---

## 中文

Sage（以下简称"本应用"）由 YIYANG CAI 开发。本隐私政策说明本应用如何处理您的信息。

### 需要账号

Sage 是一款在线服务产品，定位为您的"金融数字分身"。为了提供跨设备同步和记忆延续能力，**使用本应用需要注册账号**。账号认证由 Supabase 提供。

### 我们存储的数据

为了实现 Sage 的记忆能力和跨设备功能，我们会在云端基础设施（Supabase）上存储以下数据：

- **账号信息**：邮箱地址（用于账号识别）
- **会话数据**：聊天历史、会话、任务、文件元数据
- **分身**：从您的对话中自动整理出的笔记，markdown 格式（详见下方"分身的形成"）
- **您的笔记**：您在「设置 → 记忆」中主动写下的任何内容

同时，我们会在您的设备本地（桌面端 SQLite / iOS 端 IndexedDB）保留一份完整的会话数据副本，用于快速离线读取。

### 我们对数据使用的承诺

除了存储数据以提供功能之外，我们做出以下具有约束力的承诺：

1. **不分析、不二次使用**：您的会话数据**不会**被用于训练模型、广告投放或任何其他商业用途
2. **不与第三方共享**：除下方列出的技术服务商外，我们不会向任何第三方出售、交易或分享您的会话数据
3. **您有完全的控制权**：您可以随时从「设置 → 记忆 → 数据管理」清除所有会话数据和笔记（云端 + 本地）。账号会保留（除非您单独删除账号）
4. **透明可见**：您可以随时在「设置 → 记忆」中查看 Sage 整理出的"分身"

### 分身的形成

为了让 Sage 真正成为您的数字分身，本应用会定期（每晚）运行一个自动流程，读取您近期的对话并整理成一份摘要，存为 `profile.content_md`。这份摘要帮助 Sage 在跨会话场景中记住您的偏好和上下文。

这个整理流程：
- 在我们的云端基础设施（Railway）上自动运行
- 使用第三方大语言模型（详见下方"第三方服务"）
- 产出一份您在「设置 → 记忆」中可见的 markdown 笔记
- 整理结果**不会**与任何第三方共享，仅在您与 Sage 之间使用

### 第三方服务

本应用依赖以下第三方服务：

| 服务 | 用途 | 传递数据 |
|------|------|---------|
| **Supabase** | 账号认证 + 数据存储 | 账号信息、对话、分身、笔记（传输+存储均加密） |
| **OpenAI / MiniMax 等** | 大模型推理（生成对话回复 + 每晚分身整理） | 对话内容（按各家 API 协议处理；这些服务商不保留您的数据） |
| **金融数据 API**（iwencai、westock 等） | 实时市场数据 | 仅查询参数（如股票代码），**不传递个人信息** |

### 数据加密

- **传输加密**：所有通信使用 HTTPS / TLS 加密
- **静态加密**：Supabase 默认对磁盘存储的数据加密
- **访问控制**：Supabase Row-Level Security (RLS) 策略强制确保一个用户绝对无法访问另一个用户的数据
- **端到端加密（E2EE）**：我们**不**提供 E2EE。这是经过权衡的决策——E2EE 会让云端无法运行分身整理和全文搜索，而这两者是 Sage 价值的核心。我们的基础设施在必要时可以读取您的数据以提供服务，但我们承诺（如上）不会将其用于服务您之外的任何用途。

### 备份说明

Supabase 会自动维护数据库备份以保障服务可靠性（Point-in-Time Recovery，Pro 计划通常保留 7 天）。当您清除数据时，在线数据会立即删除，旧的备份快照会在备份保留窗口内自然轮换淘汰。

### 错误日志（可选，用户主动触发）

当您从 Sage 内主动提交错误日志时，我们会分析这些日志以改进产品。**这是上述"不分析"承诺的唯一例外，且仅在您明确触发时发生。**

### 数据清除

您可以通过以下方式清除数据：

1. **应用内清除**：「设置 → 记忆 → 数据管理 → 清除所有对话与笔记」
   - 这会永久删除您云端+本地的会话数据、分身和笔记
   - 您的账号和设置会保留
2. **账号删除**：请通过 GitHub Issue 联系我们。账号删除是永久的，无法撤销。

### 联系方式

如果您对本隐私政策有任何疑问，请通过以下方式联系：

- GitHub: [https://github.com/buuzzy/sage](https://github.com/buuzzy/sage)
- 邮箱：在 GitHub 仓库提交 Issue
