# HTclaw 项目 Skills 加载机制彻底分析

**日期**: 2026-04-19  
**分析对象**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app`

---

## 核心结论

### ✅ 技能加载机制：**按 `whenToUse` 关键词按需召回（动态注入）**

**而非**"全量注入所有 SKILL.md"。

---

## 加载流程详解

### 第 1 层：系统 Prompt 构建（每次调用都完整加载）

**文件**: `src-api/src/config/prompt-loader.ts`

```
getHTClawSystemPrompt(userQuery) 
  ├─ getSoulPrompt() → 从 ~/.htclaw/SOUL.md 缓存读取
  ├─ getAgentsPrompt() → 从 ~/.htclaw/AGENTS.md 缓存读取
  └─ loadMemory(userQuery)
      ├─ 若有 vector 索引 → 语义搜索相关记忆
      └─ 否则 → 全文加载 user.md + MEMORY.md + 最近日期的 memory/*.md
```

**关键点**:
- **SOUL.md**: 缓存在内存中 (`cachedSoulPrompt`，首次加载后为常量)
- **AGENTS.md**: 也缓存在内存中 (`cachedAgentsPrompt`，首次加载后为常量)
- **Memory**: 每次调用时检查是否需要更新
- **注入时机**: 在 `CodeAnyAgent.run()` / `CodeAnyAgent.plan()` / `CodeAnyAgent.execute()` 中调用
- **注入方式**: 作为 `finalPrompt` 的前缀：

```typescript
const htclawSystemPrompt = await getHTClawSystemPrompt(prompt);
const finalPrompt = htclawSystemPrompt + getWorkspaceInstruction(...) + ... + prompt;
```

---

### 第 2 层：Skills 动态注入（按提示词关键词筛选）

**核心文件**: `src-api/src/shared/skills/predictor.ts`

#### 加载流程：

```
refreshSkillsForPrompt(prompt)
  ├─ loadAndCacheSkills()  [第一次：加载所有 skills]
  │   ├─ loadAllSkills()  [从 ~/.claude/skills 和 ~/.htclaw/skills 读取]
  │   └─ 过滤禁用的 skills (读取 ~/.htclaw/skills-config.json)
  │   └─ 缓存到内存 cachedSkills[]
  │
  └─ selectRelevantSkills(prompt, maxSkills=5)
      ├─ 对每个 skill，分数 = 提示词中命中的 whenToUse 关键词数
      ├─ 排序 & 取 Top 5
      └─ 若无匹配 → 返回冷启动技能集 (COLD_START_SKILL_NAMES)
      
  └─ clearSkills() + registerSkill() [更新 SDK 的技能注册表]
```

#### 关键数据结构：

```typescript
interface CachedSkill {
  name: string;
  description: string;
  whenToUse: string;           // 原始字符串，如 "股价,行情,现价,涨跌,K线"
  whenToUseKeywords: string[]; // split + 小写后的关键词数组
  getPrompt: (args) => Promise<SkillContentBlock[]>;
}
```

#### 评分算法：

```typescript
function scoreSkill(skill: CachedSkill, normalizedPrompt: string): number {
  let score = 0;
  for (const kw of skill.whenToUseKeywords) {
    if (normalizedPrompt.includes(kw)) score += 1;
  }
  return score;
}
```

**示例**:
- 提示词: "查询茅台的股价和K线"
- 正常化: "查询茅台的股价和k线"
- westock-quote skill 的 `whenToUse` 包含: "股价,行情,K线,..."
- 命中数: 3 → score = 3
- 其他 skill 得分较低 → westock-quote 被选中

#### 冷启动机制：

```typescript
const COLD_START_SKILL_NAMES = [
  '行情数据查询',      // iwencai stock quote
  '新闻搜索',          // news search
  'westock-quote',     // tencent quote
];
```

**触发条件**: 当所有 skills 的得分都为 0（即没有任何 whenToUse 关键词匹配）时，注入这 3 个基础技能。

#### 注入时机：

在 `CodeAnyAgent.run()` 中调用：

```typescript
// 第 448-450 行
// Dynamically swap in only the skills relevant to this prompt
// so the model context stays lean each turn.
await refreshSkillsForPrompt(prompt);
```

在 `CodeAnyAgent.execute()` 中也调用：

```typescript
// 第 610-613 行
// Dynamically swap in only the skills relevant to this plan's original prompt
if (options.originalPrompt) {
  await refreshSkillsForPrompt(options.originalPrompt);
}
```

---

### 第 3 层：Skills 源加载（初始化 + 缓存）

**文件**: `src-api/src/shared/skills/loader.ts`

#### 加载源：

1. **用户技能**: `~/.claude/skills/`（Claude Code 标准目录）
2. **应用技能**: `~/.htclaw/skills/`（HTclaw 内置技能）

#### 每个 Skill 的结构：

```
~/.htclaw/skills/westock-quote/
├── SKILL.md                    # 必需：YAML frontmatter + markdown content
├── example.json                # 可选
└── ... (other files)
```

#### SKILL.md 格式：

```markdown
---
name: westock-quote
description: "腾讯金融数据查询"
promptDescription: "腾讯行情数据：实时价格、K线历史、技术指标"  # 30-60 字，用于 SDK 注入
whenToUse: "股价,行情,现价,涨跌,K线,日K,周K,均线,MACD,KDJ,RSI,..."
author: "Team"
version: "1.0.0"
argumentHint: "股票代码或名称"
---

# 详细说明
（Markdown 内容，提供完整的 API 调用指南、参数说明等）
```

#### 禁用技能配置：

**文件**: `~/.htclaw/skills-config.json`

```json
{
  "disabledSkills": ["skill-name-1", "skill-name-2"]
}
```

**读取时机**: 在 `loadAndCacheSkills()` 中：

```typescript
const disabled = new Set(getDisabledSkills());
cachedSkills = skills
  .filter((s) => !disabled.has(s.name))  // 过滤禁用项
  .map(s => ({...}));
```

---

## 整体的 System Prompt 构建流程

### 调用链：

```
用户发起对话
  ↓
API /agent/chat 或 /agent/plan 或 /agent/execute
  ↓
CodeAnyAgent.run() / plan() / execute()
  ↓
构建提示词：
  ├─ getHTClawSystemPrompt(prompt)
  │   ├─ SOUL.md (缓存)
  │   ├─ AGENTS.md (缓存)
  │   └─ Memory (可选：向量搜索或全文加载)
  │
  ├─ getWorkspaceInstruction(workDir)
  │   └─ 注入工作目录约束
  │
  ├─ buildLanguageInstruction(language, prompt)
  │   └─ 注入语言约束（中文/英文）
  │
  └─ refreshSkillsForPrompt(prompt)
      ├─ 加载 + 缓存所有可用 skills
      ├─ 按 whenToUse 关键词评分
      ├─ 选出 Top 5 skills（或冷启动 3 个）
      └─ 调用 SDK 的 registerSkill()，实际注入 SDK 上下文
      
  ↓
finalPrompt = SOUL + AGENTS + Memory + Workspace + Language + Skills + UserPrompt
  ↓
传给 CodeAny SDK 的 query() 函数
  ↓
model.run()
```

### 关键特点：

1. **SOUL.md 和 AGENTS.md 的注入频率**:
   - ✅ 每次会话都加载（但从内存缓存读取，无文件 I/O）
   - ✅ 使用频率极高（作为系统角色定义）
   - ❌ 不是按需筛选的

2. **Skills 的注入频率**:
   - ✅ 每次会话都调用 `refreshSkillsForPrompt()`
   - ✅ **按 whenToUse 关键词动态筛选**（核心创新）
   - ✅ 最多 5 个 skills 被注入 SDK 上下文（节省 token）
   - ✅ 若无匹配，注入 3 个冷启动 skills

3. **Memory 的注入频率**:
   - ✅ 若有向量索引 → 语义搜索相关片段
   - ✅ 否则 → 全文加载 user.md、MEMORY.md 和最近日期的 memory/*.md

---

## 代码路径速查

| 功能 | 文件 | 主要函数 |
|------|------|--------|
| 系统 Prompt 加载 | `src/config/prompt-loader.ts` | `getHTClawSystemPrompt()` |
| Skills 加载 + 缓存 | `src/shared/skills/loader.ts` | `loadAllSkills()`, `loadSkillFromDir()` |
| Skills 按需筛选 | `src/shared/skills/predictor.ts` | `refreshSkillsForPrompt()`, `selectRelevantSkills()` |
| Skills 配置管理 | `src/shared/skills/config.ts` | `getDisabledSkills()`, `setSkillEnabled()` |
| CodeAny 代理实现 | `src/extensions/agent/codeany/index.ts` | `CodeAnyAgent.run()`, `.plan()`, `.execute()` |

---

## 性能影响分析

### Token 预算：

| 组件 | 大小 | 加载方式 | 频率 |
|------|------|--------|------|
| SOUL.md | 通常 500-1000 chars | 内存缓存 | 每次会话 |
| AGENTS.md | 通常 1000-2000 chars | 内存缓存 | 每次会话 |
| Memory | 可变（1-8 个相关片段） | 向量搜索或全文 | 每次会话 |
| Workspace Instruction | 固定 ~300 chars | 动态生成 | 每次会话 |
| Skills (全量) | ~15 skills × 40 chars ≈ 600 chars (~150 tokens) | 仅加载 1 次，缓存 | 仅初始化 |
| Skills (注入) | ~3-5 matched skills × 40 chars ≈ 120-200 chars (~30-50 tokens) | 按需选择 | 每次会话 |

**结论**: 通过动态 skills 注入，平均每次会话节省 ~100 tokens（相比全量注入）。

---

## 配置点与扩展

### 1. 添加新 Skill：

1. 在 `~/.htclaw/skills/my-skill/` 创建目录
2. 编写 `SKILL.md`，包含 frontmatter：
   ```yaml
   ---
   name: my-skill
   promptDescription: "简短说明"
   whenToUse: "关键词1,关键词2,关键词3"
   ---
   ```
3. 代理下次启动时自动加载

### 2. 禁用某个 Skill：

调用 API：
```bash
POST /skills/toggle
{ "name": "skill-name", "enabled": false }
```

会修改 `~/.htclaw/skills-config.json`，下次会话时过滤。

### 3. 调整评分算法：

编辑 `src/shared/skills/predictor.ts` 中的 `scoreSkill()` 和 `selectRelevantSkills()`。

### 4. 调整冷启动 Skills：

编辑 `COLD_START_SKILL_NAMES` 常量。

---

## 总结

| 维度 | 答案 |
|------|------|
| **Skills 加载是全量还是按需？** | **按需（动态注入）** |
| **whenToUse 字段如何处理？** | **用逗号分隔的关键词，与提示词做子字符串匹配，计分排序** |
| **每次注入多少 skills？** | **最多 5 个（或冷启动 3 个）** |
| **AGENTS.md 加载频率？** | **每次会话都加载（但从内存缓存）** |
| **SOUL.md 加载频率？** | **每次会话都加载（但从内存缓存）** |
| **Memory 加载频率？** | **每次会话（向量搜索或全文）** |
| **缓存策略？** | **Skills 列表首次加载后缓存；SOUL/AGENTS 使用长期缓存** |
| **Token 优化效果？** | **通过动态 skills 注入，平均节省 ~100 tokens/turn** |

---

## 代码流程图（简化）

```
用户提示词
  ↓
  ├─→ getHTClawSystemPrompt()
  │    ├─ getSoulPrompt() [缓存]
  │    └─ getAgentsPrompt() [缓存]
  │
  ├─→ refreshSkillsForPrompt(prompt)
  │    ├─ loadAndCacheSkills() [仅第 1 次]
  │    └─ selectRelevantSkills()
  │        └─ scoreSkill(skill, prompt) for each skill
  │        └─ 取 Top 5
  │        └─ registerSkill() to SDK
  │
  ├─→ getWorkspaceInstruction()
  └─→ buildLanguageInstruction()

  ↓ 合并
  
最终 Prompt
  ↓
CodeAny SDK query()
  ↓
模型响应
```

