---
name: 定时任务管理
description: 创建、查看、修改、删除定时任务（Cron Job）。当用户说"每天早上X点帮我做某事"、"定时监控某某"、"设一个提醒"、"取消/禁用某个任务"、"查看我的定时任务"等涉及周期性或延时自动执行的请求时，使用此技能。
promptDescription: 创建/查看/删除定时任务（Cron Job），周期性或延时自动执行
whenToUse: 定时,定时任务,提醒,每天,每周,早报,预警,价格提醒,设置任务,取消任务,查看任务
---

# 定时任务管理技能

## ⚡ 执行规则（必须遵守）

**读完本 SKILL.md 后，你必须立即使用 `Bash` 工具执行对应的 `curl` 命令，然后将结果返回给用户。不能只描述步骤，不能只解释流程，必须直接执行。**

## 技能概述

通过调用本地 HT Claw API（`http://127.0.0.1:2026`）管理用户的定时任务（Cron Job）。  
任务到期后由系统自动启动独立 Agent 会话执行 prompt，结果可推送到飞书渠道。

---

## 操作类型与触发条件

| 用户意图 | 操作 |
|---------|------|
| "每天早上9点…" / "每周一…" / "每X小时…" | 创建周期性任务（cron 或 every） |
| "X点提醒我…" / "明天上午…做一次" | 创建一次性任务（at + deleteAfterRun） |
| "单独触发一次…" / "立即执行…" / "帮我跑一次…" | 先查找对应任务，再手动触发 POST /cron/jobs/:id/run |
| "查看/列出我的定时任务" | 列出所有任务 |
| "取消/禁用/启用/修改某任务" | 更新或删除任务 |
| "立即执行某任务" | 手动触发任务 |
| "茅台跌破1500提醒我" | 创建价格监控任务（every + 条件检查 prompt） |

---

## API 端点（本地服务，无需认证）

```
基础 URL: http://127.0.0.1:2026

GET    /cron/jobs              列出所有任务
GET    /cron/jobs/:id          获取单个任务详情
POST   /cron/jobs              创建任务
PUT    /cron/jobs/:id          更新任务
DELETE /cron/jobs/:id          删除任务（系统任务不可删除）
POST   /cron/jobs/:id/run      手动立即执行
```

---

## 请求/响应格式

### 创建任务 POST /cron/jobs

**请求体：**
```json
{
  "name": "任务名称（简洁易懂）",
  "prompt": "任务 prompt（系统会启动独立 Agent 执行此 prompt）",
  "schedule": { ... },
  "delivery": "none",
  "enabled": true,
  "deleteAfterRun": false,
  "jitter": 30000
}
```

### Schedule 类型

**周期性 — Cron 表达式（最常用）：**
```json
{ "type": "cron", "expression": "0 9 * * 1-5", "timezone": "Asia/Shanghai" }
```
常用表达式参考：
- `0 9 * * *` — 每天 9:00
- `0 9 * * 1-5` — 工作日 9:00
- `0 23 * * *` — 每天 23:00
- `30 8 * * 1` — 每周一 8:30
- `0 */2 * * *` — 每2小时整点

**固定间隔（适合价格监控等高频检查）：**
```json
{ "type": "every", "interval": 300000 }
```
interval 单位毫秒，最小 1000（1秒）。常用：
- `300000` = 5分钟
- `3600000` = 1小时
- `86400000` = 24小时

**一次性（精确时间）：**
```json
{ "type": "at", "at": "2026-04-19T09:00:00+08:00" }
```
配合 `"deleteAfterRun": true` 使用，执行后自动删除。

### Delivery（推送方式）

- `"none"` — 不推送，结果记录在任务历史
- `"channel"` — 执行结果推送到飞书渠道（需同时提供 `targetConversationId`）

带推送示例：
```json
{
  "delivery": "channel",
  "targetConversationId": "oc_abc123def456"
}
```

---

## Prompt 编写指南

任务 prompt 会在独立 Agent 会话中执行，**可以使用所有内置技能**（行情查询、新闻搜索等）。

### 市场早报示例：
```
查询今日 A 股市场概况：上证、深证、创业板指数涨跌，昨日涨跌停数量，今日开盘情绪。
同时搜索最近24小时重要财经新闻前3条。
输出格式：简洁的文字早报，200字以内。
```

### 价格监控示例（需要"推送到飞书"）：
```
查询贵州茅台（600519.SH）当前最新价格。
如果价格低于1500元，输出：【价格提醒】贵州茅台当前报价 {price} 元，已跌破1500元阈值。
如果价格高于等于1500元，输出：价格正常，当前 {price} 元，未触发提醒。
```
> 注：监控任务建议配合 `delivery: "channel"` 使用，这样触发时结果会推送到飞书。由于每次都会执行，如果只需"触发一次后停止"，可以在 prompt 中包含删除自身的逻辑，或告知用户手动禁用。

### 个人提醒示例：
```
提醒用户：今天是季报披露截止日，记得检查持仓股票的财报。
```

---

## Jitter（抖动）说明

- `jitter` 字段为最大随机延迟毫秒数（0 = 关闭抖动）
- 默认值：30000（30秒），适合大多数日常任务
- 一次性任务（type=at）不使用 jitter

---

## 完整操作示例

### 示例1：创建每日市场早报

```bash
curl -s -X POST http://127.0.0.1:2026/cron/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "每日市场早报",
    "prompt": "查询今日 A 股市场概况（上证、深证、创业板指数），以及今日最重要的3条财经新闻。输出简洁文字早报，150字以内。",
    "schedule": { "type": "cron", "expression": "0 9 * * 1-5", "timezone": "Asia/Shanghai" },
    "delivery": "none",
    "enabled": true,
    "deleteAfterRun": false,
    "jitter": 60000
  }'
```

### 示例2：创建价格监控（5分钟检查一次，推送飞书）

```bash
curl -s -X POST http://127.0.0.1:2026/cron/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "茅台价格监控",
    "prompt": "查询贵州茅台（600519.SH）当前最新价格。如价格低于1500元，输出【价格提醒】茅台当前 {price} 元，已跌破1500元；否则输出正常。",
    "schedule": { "type": "every", "interval": 300000 },
    "delivery": "channel",
    "targetConversationId": "用户的飞书会话ID",
    "enabled": true,
    "deleteAfterRun": false,
    "jitter": 0
  }'
```

### 示例3：一次性提醒

```bash
curl -s -X POST http://127.0.0.1:2026/cron/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "一次性提醒",
    "prompt": "提醒用户：今天是约定的复盘时间，请检查本周持仓表现。",
    "schedule": { "type": "at", "at": "2026-04-19T20:00:00+08:00" },
    "delivery": "none",
    "enabled": true,
    "deleteAfterRun": true,
    "jitter": 0
  }'
```

### 示例4：列出所有任务

```bash
curl -s http://127.0.0.1:2026/cron/jobs | python3 -m json.tool
```

### 示例5：禁用任务

```bash
curl -s -X PUT http://127.0.0.1:2026/cron/jobs/{id} \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### 示例6：删除任务

```bash
curl -s -X DELETE http://127.0.0.1:2026/cron/jobs/{id}
```

### 示例7：手动立即执行

```bash
curl -s -X POST http://127.0.0.1:2026/cron/jobs/{id}/run | python3 -m json.tool
```

---

## 响应处理

**成功创建：** HTTP 201，body 中有 `ok: true` 和 `job` 对象（含 `id`）。  
**成功更新/删除：** HTTP 200，body 中有 `ok: true`。  
**错误：** HTTP 4xx/5xx，body 中有 `error` 字段。

---

## 工作流程

### A. 创建/管理 Job（主流程）

1. **理解意图** — 确认用户想做什么（创建/查看/修改/删除）
2. **提取参数** — 从用户话语中提取：
   - 任务内容（→ `prompt`）
   - 执行时间/频率（→ `schedule`）
   - 是否需要推送（→ `delivery`）
   - 是否一次性（→ `deleteAfterRun`）
3. **确认关键信息** — 如果时间频率不明确，向用户确认
4. **立即用 Bash + curl 调用 API** — 不要等待，直接执行
5. **反馈结果** — 告知用户任务 ID、名称、执行时间

### B. 触发已有 Job（手动执行）

1. 先 `GET /cron/jobs` 找到对应 job 的 id
2. 再 `POST /cron/jobs/:id/run` 手动触发
3. 等待响应（run 结果会在 response 的 `run.output` 字段），展示给用户

### C. "帮我预览/单独看一次效果"（无需 Job）

**如果用户只是想看某个任务的效果，而这个 Job 不一定存在，直接退出本技能，告知用户：**
> "这不需要通过定时任务系统。我可以直接帮你执行这个查询，请稍等。"
> 
> 然后立即调用相关技能（如行情数据查询、新闻搜索等）直接完成用户请求。

---

## 注意事项

- API 只接受本机请求（127.0.0.1），无需任何认证
- 系统内置任务（如每日记忆归纳 `sys-memory-consolidation`）不能删除，但可以禁用
- 价格监控任务不会自动停止，用户触发后需手动删除或禁用
- `targetConversationId` 是飞书的 chat_id 或 open_id，用户需要提供；如果不知道，告知用户可以在飞书渠道设置里找到
- 任务 prompt 在独立隔离会话执行，**无法访问当前对话上下文**，prompt 要自包含
