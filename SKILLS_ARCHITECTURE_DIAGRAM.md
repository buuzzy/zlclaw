# HTclaw Skills 加载架构 - 可视化流程图

## 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     用户发起对话                                  │
│              POST /agent/chat, /plan, /execute                   │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              CodeAnyAgent.run() / plan() / execute()             │
│                 (src/extensions/agent/codeany/)                  │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
                  【系统 Prompt 构建】
                             ↓
           ┌──────────────────┼──────────────────┐
           ↓                  ↓                  ↓
   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
   │getHTClawSystem  │  │getWorkspace     │  │buildLanguage     │
   │Prompt()         │  │Instruction()    │  │Instruction()     │
   │[prompt-loader]  │  │[base.ts]        │  │[base.ts]         │
   └────────┬────────┘  └────────┬────────┘  └────────┬─────────┘
            ↓                    ↓                     ↓
     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
     │① SOUL.md     │    │工作目录      │    │语言约束      │
     │[缓存]        │    │(~/.htclaw)   │    │(en/zh-cn)    │
     │             │    │             │    │             │
     │② AGENTS.md  │    │优先级指令    │    │             │
     │[缓存]        │    │sandbox 配置  │    │             │
     │             │    │             │    │             │
     │③ Memory     │    └──────────────┘    └──────────────┘
     │  ├ user.md  │
     │  ├ MEMORY.md│
     │  └ memory/  │
     │    *.md     │
     │[向量搜索 or │
     │ 全文]      │
     └──────────────┘
                             ↓
           ┌─────────────────────────────────────┐
           │    refreshSkillsForPrompt(prompt)   │
           │   [predictor.ts] 【关键】           │
           └────────────────┬────────────────────┘
                            ↓
           ┌────────────────────────────────────┐
           │                                    │
           │  ① loadAndCacheSkills()            │
           │     (仅第 1 次执行)                 │
           │                                    │
           └────────────────┬───────────────────┘
                            ↓
          ┌──────────────────────────────────────┐
          │ loadAllSkills()                      │
          │ [loader.ts]                          │
          │                                      │
          │ 扫描两个目录:                         │
          │ ├ ~/.claude/skills/                  │
          │ └ ~/.htclaw/skills/                  │
          │                                      │
          │ 对每个目录下的 skill/:               │
          │   ├ 读取 SKILL.md                    │
          │   ├ 解析 YAML frontmatter            │
          │   └ 提取元数据                       │
          │       ├ name                         │
          │       ├ description                  │
          │       ├ promptDescription            │
          │       ├ whenToUse (关键词!)         │
          │       └ ...                          │
          │                                      │
          │ 返回 LoadedSkill[]                   │
          └──────────────┬───────────────────────┘
                         ↓
          ┌──────────────────────────────────┐
          │ 过滤禁用的 skills                  │
          │ [config.ts]                       │
          │                                   │
          │ 读取 ~/.htclaw/skills-config.json │
          │ {                                  │
          │   "disabledSkills": [...]         │
          │ }                                  │
          │                                   │
          │ 得到 cachedSkills[]               │
          └──────────────┬────────────────────┘
                         ↓
    ┌────────────────────────────────────────┐
    │  ② selectRelevantSkills(prompt, max=5) │
    │     [predictor.ts] 【核心算法】         │
    └────────────────┬───────────────────────┘
                     ↓
    ┌───────────────────────────────────────────────────────┐
    │ 对每个 skill:                                          │
    │                                                        │
    │   score = 0                                            │
    │   normalize(prompt) → lowercase                        │
    │                                                        │
    │   for kw in skill.whenToUseKeywords:                   │
    │       if normalized_prompt.includes(kw):              │
    │           score += 1                                  │
    │                                                        │
    │ 示例:                                                  │
    │   prompt: "查询茅台股价和K线"                         │
    │   normalized: "查询茅台股价和k线"                     │
    │                                                        │
    │   westock-quote:                                       │
    │     whenToUse: "股价,行情,K线,..."                   │
    │     keywords: ["股价","行情","k线",...]              │
    │     score = 3 ✓                                        │
    │                                                        │
    │   其他 skills score 较小                              │
    │                                                        │
    │ 排序 & Top 5 ← 返回                                   │
    └───────────────────────────────────────────────────────┘
                     ↓
    ┌───────────────────────────────────────────┐
    │ 若 scored.length == 0:                    │
    │   返回 COLD_START_SKILL_NAMES:            │
    │   [                                       │
    │     '行情数据查询',     // iwencai        │
    │     '新闻搜索',         // news           │
    │     'westock-quote'     // tencent        │
    │   ]                                       │
    │                                           │
    │ 否则:                                     │
    │   返回 scored 前 5 个                    │
    └───────────────┬───────────────────────────┘
                    ↓
    ┌───────────────────────────────────────────┐
    │ ③ registerSkill() 到 SDK                  │
    │    [predictor.ts]                         │
    │                                           │
    │ clearSkills()  // 清空之前的注册          │
    │                                           │
    │ for skill in selected:                   │
    │   registerSkill({                        │
    │     name: skill.name,                    │
    │     description: skill.description,      │
    │     whenToUse: skill.whenToUse,          │
    │     getPrompt: skill.getPrompt,          │
    │     ...                                   │
    │   })                                      │
    │                                           │
    │ 最多 5 个 skills 被注入 SDK 上下文      │
    └───────────────┬───────────────────────────┘
                    ↓
           ┌─────────────────────┐
           │ 构建最终 Prompt     │
           └──────────┬──────────┘
                      ↓
    ┌──────────────────────────────────┐
    │ finalPrompt =                    │
    │   SOUL.md +                      │
    │   AGENTS.md +                    │
    │   Memory +                       │
    │   WorkspaceInstruction +         │
    │   LanguageInstruction +          │
    │   UserPrompt                     │
    │                                  │
    │ (已注入 3-5 个相关 skills)       │
    └──────────────┬───────────────────┘
                   ↓
    ┌──────────────────────────────────┐
    │ query(                           │
    │   prompt: finalPrompt,           │
    │   options: sdkOpts               │
    │ )                                │
    │ [CodeAny SDK]                    │
    └──────────────┬───────────────────┘
                   ↓
           ┌─────────────────┐
           │  Model Response │
           └─────────────────┘
```

---

## Skills 加载层级关系

```
【第 1 层】- 源加载 (初始化，仅一次)
┌──────────────────────────────────┐
│ loadAllSkills()                  │
│ ├─ ~/.claude/skills/             │
│ └─ ~/.htclaw/skills/             │
│                                  │
│ 返回: LoadedSkill[]              │
│ (包含完整 metadata + 文件内容)   │
└──────────┬───────────────────────┘
           ↓ 缓存 cachedSkills[]

【第 2 层】- 过滤 (初始化，仅一次)
┌──────────────────────────────────┐
│ 过滤禁用 skills                   │
│ (来自 skills-config.json)        │
└──────────┬───────────────────────┘
           ↓

【第 3 层】- 评分 & 选择 (每次会话)
┌──────────────────────────────────┐
│ scoreSkill() for each skill      │
│ → sorted[].slice(0, 5)           │
│ → selectRelevantSkills()         │
└──────────┬───────────────────────┘
           ↓

【第 4 层】- SDK 注册 (每次会话)
┌──────────────────────────────────┐
│ registerSkill() × N (N≤5)        │
│ → SDK skill context               │
│                                  │
│ 实际注入的 skills 进入           │
│ CodeAny SDK 的上下文              │
└──────────────────────────────────┘
```

---

## 文件布局

```
项目根目录
├── src-api/
│   ├── src/
│   │   ├── config/
│   │   │   └── prompt-loader.ts          ← SOUL/AGENTS 加载、Memory 加载
│   │   │
│   │   ├── shared/
│   │   │   └── skills/
│   │   │       ├── loader.ts             ← 从磁盘读取 SKILL.md
│   │   │       ├── predictor.ts          ← 核心：选择与注册 skills
│   │   │       ├── config.ts             ← 管理禁用状态
│   │   │       ├── register.ts           ← (可能的其他注册逻辑)
│   │   │       └── index.ts
│   │   │
│   │   └── extensions/
│   │       └── agent/
│   │           └── codeany/
│   │               └── index.ts          ← CodeAnyAgent 实现
│   │                                       调用 refreshSkillsForPrompt()
│   │                                       & getHTClawSystemPrompt()
│   │
│   └── resources/
│       └── skills/                       ← 内置 skills
│           ├── westock-quote/
│           │   └── SKILL.md
│           ├── westock-market/
│           │   └── SKILL.md
│           ├── westock-research/
│           │   └── SKILL.md
│           └── ...
│
├── ~/.claude/skills/                     ← 用户自定义 skills
│   └── my-skill/
│       └── SKILL.md
│
├── ~/.htclaw/                            ← 应用配置目录
│   ├── SOUL.md                           ← 系统角色定义
│   ├── AGENTS.md                         ← 工作流规范
│   ├── MEMORY.md                         ← 长期记忆
│   ├── user.md                           ← 用户画像
│   ├── skills/                           ← 应用内置 skills
│   │   └── (copied from resources/)
│   ├── skills-config.json                ← 禁用状态配置
│   ├── memory/                           ← 每日记忆
│   │   ├── 2026-04-19.md
│   │   ├── 2026-04-18.md
│   │   └── ...
│   └── logs/
│       └── htclaw.log
```

---

## 数据结构详解

### SKILL.md 前置元数据

```yaml
---
name: westock-quote
description: "腾讯金融行情数据技能"
promptDescription: "腾讯行情数据：实时价格、K线历史、分时、技术指标、资金流向"
whenToUse: "股价,行情,现价,涨跌,K线,日K,周K,均线,MACD,KDJ,RSI,布林线,..."
author: "Team"
version: "1.0.0"
argumentHint: "股票代码或名称"
---

# 详细使用指南
（Markdown 内容）
```

### 运行时 CachedSkill

```typescript
interface CachedSkill {
  name: string;                                    // "westock-quote"
  description: string;                            // 长文本说明
  whenToUse: string;                             // 原始 frontmatter 值
  whenToUseKeywords: string[];                  // ["股价","行情","现价","涨跌","k线",...]
  argumentHint?: string;                         // 可选参数提示
  getPrompt: (args: string) => Promise<...>;   // 返回 Skill 内容块
}
```

### skills-config.json

```json
{
  "disabledSkills": ["skill-name-1", "skill-name-2"]
}
```

---

## 关键参数与常量

| 常量名 | 值 | 说明 |
|--------|----|----|
| `COLD_START_SKILL_NAMES` | `['行情数据查询', '新闻搜索', 'westock-quote']` | 无匹配时的备用技能 |
| `maxSkills` in `selectRelevantSkills()` | `5` | 最多选择 5 个 skills |
| `cachedSoulPrompt` | `string \| null` | SOUL.md 内存缓存 |
| `cachedAgentsPrompt` | `string \| null` | AGENTS.md 内存缓存 |
| `cachedSkills` | `CachedSkill[]` | 所有可用 skills 的缓存 |
| `cacheReady` | `boolean` | 缓存初始化标志 |

---

## 调用序列

### 第 1 次会话

```
refreshSkillsForPrompt(prompt)
  ↓
  cacheReady === false
  ↓
  loadAndCacheSkills()  ← 读取磁盘，建立 cachedSkills[]
  ↓
  cacheReady = true
  ↓
  selectRelevantSkills(prompt)
  ↓
  registerSkill() × N
```

### 第 2+ 次会话

```
refreshSkillsForPrompt(prompt)
  ↓
  cacheReady === true (已缓存)
  ↓
  selectRelevantSkills(prompt)  ← 直接用 cachedSkills[]，无磁盘 I/O
  ↓
  registerSkill() × N
```

---

## 关键优化点

### ✅ Token 节省

- **冷启动**: 第 1 次会话时，加载所有 ~15 skills (~600 chars, ~150 tokens)
- **运行时**: 之后每次会话只注入 3-5 个匹配的 skills (~120-200 chars, ~30-50 tokens)
- **节省**: 平均每次 ~100 tokens

### ✅ 缓存策略

- SOUL/AGENTS: 长期内存缓存 (应用生命周期)
- Skills 列表: 首次加载后缓存，无需重复读取磁盘
- Memory: 每次会话检查，支持向量搜索加速

### ✅ 灵活配置

- 禁用 skills: 修改 skills-config.json，下次会话自动过滤
- 添加 skills: 在 ~/.htclaw/skills/ 新增目录，自动发现
- 调整评分: 修改 scoreSkill() 函数的算法

---

## 扩展想法

### 1. 增强评分算法

当前: 关键词命中数

改进:
- 权重化: 某些关键词权重更高
- 上下文距离: 近的关键词权重更高
- TF-IDF: 考虑关键词频率和逆文档频率

### 2. 动态冷启动

当前: 固定 3 个技能

改进:
- 基于用户历史，选择常用的 3 个
- 基于时间，选择今天相关的 3 个

### 3. 技能聚类

当前: 平铺的技能列表

改进:
- 将技能分组 (如 "金融"、"通用"、"文档处理")
- 评分时优先选择相关分组内的技能

### 4. 实时学习

当前: whenToUse 关键词静态定义

改进:
- 记录用户使用模式
- 自动扩展或调整关键词
