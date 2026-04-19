# Skills 加载机制 - 快速参考指南

## 一句话核心结论

🎯 **Skills 按需动态注入，NOT 全量注入** — 每次会话根据用户提示词的 `whenToUse` 关键词匹配度，选择最多 5 个相关技能注入上下文。

---

## 关键问答

### Q1: 每次对话都会加载全部 skills 吗？

**A**: 否。

- **第 1 次会话**: 加载并缓存所有 skills (~600 chars, ~150 tokens)
- **第 2+ 次会话**: 使用缓存，选择 3-5 个匹配的 skills (~120-200 chars, ~30-50 tokens)
- **效果**: 平均节省 ~100 tokens/turn

### Q2: `whenToUse` 字段如何使用？

**A**: 评分与排序。

```
算法:
  1. 将 prompt 转小写
  2. 对每个 skill，统计有多少个 whenToUse 关键词在 prompt 中出现
  3. 得分 = 关键词命中数
  4. 排序并选取前 5 个
  5. 若无匹配，使用冷启动 skills (3 个基础技能)
```

**示例**:
```
用户输入: "查询茅台的股价和K线图"
prompt 正常化: "查询茅台的股价和k线图"

westock-quote skill:
  whenToUse: "股价,行情,K线,..."
  keywords: ["股价", "行情", "k线", ...]
  score = 3 (命中 "股价"、"k线") ✓

westock-market skill:
  whenToUse: "热搜,排行,新股,..."
  keywords: ["热搜", "排行", "新股", ...]
  score = 0 ✗

→ 选中 westock-quote
```

### Q3: AGENTS.md 和 SOUL.md 如何注入？

**A**: 每次会话都注入，但从内存缓存读取（零磁盘 I/O）。

```
getHTClawSystemPrompt()
  ├─ SOUL.md (内存缓存) ← 首次加载后，应用生命周期内不再读磁盘
  ├─ AGENTS.md (内存缓存) ← 同上
  └─ Memory (可选)
      ├─ 若有向量索引 → 语义搜索相关片段
      └─ 否则 → 全文加载 user.md + MEMORY.md + 最近日期的 memory/*.md
```

### Q4: 每次会话注入多少 skills？

**A**: 3-5 个。

- **有匹配**: 选择得分最高的前 5 个
- **无匹配**: 使用冷启动 3 个 (`['行情数据查询', '新闻搜索', 'westock-quote']`)

### Q5: 如何禁用一个 skill？

**A**: 调用 API 或编辑配置文件。

```bash
# 方式 1: API
POST /skills/toggle
{
  "name": "skill-name",
  "enabled": false
}

# 方式 2: 直接编辑
~/.htclaw/skills-config.json
{
  "disabledSkills": ["skill-name"]
}
```

下次会话时自动过滤。

### Q6: 如何添加新 skill？

**A**: 在 `~/.htclaw/skills/` 创建目录并添加 `SKILL.md`。

```
~/.htclaw/skills/my-skill/
├── SKILL.md (必需)
└── (其他文件可选)

SKILL.md:
---
name: my-skill
promptDescription: "简短说明（30-60 字）"
whenToUse: "关键词1,关键词2,关键词3"
---

# 详细文档
```

代理下次启动时自动发现加载。

### Q7: Skills 缓存策略是什么？

**A**: 分层缓存。

| 组件 | 缓存策略 | 更新时机 |
|------|--------|--------|
| SOUL.md | 应用生命周期缓存 | 重启后重新加载 |
| AGENTS.md | 应用生命周期缓存 | 重启后重新加载 |
| Skills 列表 | 首次加载后缓存 | 需要手动调用 `loadAndCacheSkills(force=true)` 更新 |
| Memory | 每次会话检查 | 可进行向量搜索 |

---

## 代码路径速查

| 需求 | 文件 | 函数 |
|------|------|------|
| 了解 skills 的加载与选择 | `src-api/src/shared/skills/predictor.ts` | `refreshSkillsForPrompt()`, `selectRelevantSkills()` |
| 了解 SKILL.md 的读取 | `src-api/src/shared/skills/loader.ts` | `loadSkillFromDir()`, `loadAllSkills()` |
| 了解 SOUL/AGENTS 的加载 | `src-api/src/config/prompt-loader.ts` | `getHTClawSystemPrompt()` |
| 了解 skills 配置管理 | `src-api/src/shared/skills/config.ts` | `getDisabledSkills()`, `setSkillEnabled()` |
| 了解完整流程 | `src-api/src/extensions/agent/codeany/index.ts` | `CodeAnyAgent.run()`, `CodeAnyAgent.plan()`, `CodeAnyAgent.execute()` |

---

## 关键数字

| 指标 | 值 | 说明 |
|------|----|----|
| 初始化时加载的 skills 大小 | ~600 chars (~150 tokens) | 全部可用 skills 的 YAML frontmatter |
| 每次会话注入的 skills 大小 | ~120-200 chars (~30-50 tokens) | 3-5 个匹配的 skills 的短描述 |
| Token 节省 | ~100 tokens/turn | 平均每次会话相比全量注入的节省 |
| 最多选择的 skills 数 | 5 | `selectRelevantSkills()` 的 maxSkills 参数 |
| 冷启动 skills 数 | 3 | 无匹配时的备用技能数 |
| SOUL.md 缓存 | 应用生命周期 | 首次加载后不再读磁盘 |
| AGENTS.md 缓存 | 应用生命周期 | 首次加载后不再读磁盘 |

---

## 配置调优建议

### 1. 优化 whenToUse 关键词

为了提高匹配度，确保 `whenToUse` 包含所有可能的用户触发词：

```yaml
whenToUse: "股价,行情,现价,涨跌,K线,日K,周K,均线,MACD,..."
```

❌ 不好: 只有 1-2 个通用关键词
✅ 好: 包含 10+ 个具体关键词

### 2. 调整 maxSkills

如果觉得 5 个 skills 太多或太少，编辑 `predictor.ts`:

```typescript
export async function refreshSkillsForPrompt(prompt: string, maxSkills = 5): Promise<void> {
  // ...
  const selected = selectRelevantSkills(prompt, maxSkills);  // ← 调整这里
  // ...
}
```

### 3. 调整冷启动 skills

如果某个 skill 更常用，编辑 `COLD_START_SKILL_NAMES`:

```typescript
const COLD_START_SKILL_NAMES = [
  'your-most-common-skill',
  '新闻搜索',
  'westock-quote',
];
```

### 4. 监控评分结果

添加日志查看每次会话的 skills 选择情况：

```typescript
console.log(`[Skills/Predictor] Injected ${selected.length}/${cachedSkills.length} skill(s): [${names}]`);
```

---

## 常见误区

### ❌ 误区 1: "skills 每次都全量注入"

实际: 仅首次初始化时加载所有 skills；之后每次会话根据关键词动态选择 3-5 个。

### ❌ 误区 2: "whenToUse 关键词越多越好"

实际: 应该包含所有可能的用户触发词，但要避免过于冗长（影响缓存效率）。

### ❌ 误区 3: "AGENTS.md 和 SOUL.md 每次都从磁盘读取"

实际: 仅首次加载从磁盘读取，之后从内存缓存读取（零 I/O）。

### ❌ 误区 4: "禁用 skill 需要重启"

实际: 调用 `/skills/toggle` API，下次会话自动生效（无需重启）。

---

## 调试技巧

### 查看当前缓存的 skills

编辑 `predictor.ts`，在 `loadAndCacheSkills()` 后添加：

```typescript
console.log('Cached skills:', cachedSkills.map(s => s.name));
```

### 查看每次会话的 skills 选择

编辑 `predictor.ts`，在 `registerSkill()` 循环后添加：

```typescript
console.log(`Selected skills: ${selected.map(s => s.name).join(', ')}`);
console.log(`Scores: ${selected.map((s, i) => `${s.name}=${scores[i]}`).join(', ')}`);
```

### 验证关键词匹配

在浏览器控制台或代码中运行：

```javascript
const prompt = "查询茅台股价";
const normalized = prompt.toLowerCase();
const keywords = ["股价", "k线", "行情"];
const matches = keywords.filter(kw => normalized.includes(kw));
console.log(`Matches: ${matches.join(', ')} (score: ${matches.length})`);
```

---

## 扩展思路

### 1. 增强评分算法

当前: 简单关键词计数

改进:
- 加权评分: 某些关键词权重更高
- TF-IDF: 考虑关键词重要性
- 语义距离: 不仅匹配关键词，还考虑语义相似度

### 2. 学习式冷启动

当前: 固定 3 个技能

改进:
- 基于用户历史，记录常用技能
- 基于时间，根据当日热点选择技能

### 3. 跨会话记忆

当前: 每次会话独立选择

改进:
- 记录用户在会话中调用了哪些 skills
- 下个会话优先推荐相同的 skills

---

## 总结表

| 问题 | 答案 |
|------|------|
| **Skills 加载机制** | 按需动态注入（基于 `whenToUse` 关键词） |
| **每次加载多少** | 3-5 个匹配的 skills（首次会话加载全部但缓存） |
| **Token 节省** | ~100 tokens/turn（相比全量注入） |
| **AGENTS.md 加载** | 每次会话都加载，但从内存缓存 |
| **SOUL.md 加载** | 每次会话都加载，但从内存缓存 |
| **修改 skill** | 需要手动编辑 ~/.htclaw/skills/*/SKILL.md 或 API 调用 |
| **禁用 skill** | API `/skills/toggle` 或编辑 skills-config.json |
| **缓存失效** | 重启应用后重新加载所有文件 |

---

**更多详情**: 参考 `SKILLS_LOADING_ANALYSIS.md` 和 `SKILLS_ARCHITECTURE_DIAGRAM.md`
