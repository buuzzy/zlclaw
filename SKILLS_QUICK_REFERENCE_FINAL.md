# HTclaw Skills Processing - Quick Reference

## TL;DR (30 seconds)

| Question | Answer |
|----------|--------|
| **Does full SKILL.md load every turn?** | ❌ No |
| **What gets injected into system prompt?** | ✅ Only: name + short description (~40 chars) + keywords + hint |
| **When does full SKILL.md get injected?** | ✅ Only when skill is actually invoked by the model |
| **How many skills per turn?** | ✅ 1-5 matched skills (by keyword scoring), or 3 cold-start |
| **Token savings?** | ✅ ~100-150 tokens/turn if skill not used |

---

## Architecture at a Glance

```
FRONTEND sends POST /agent (port 2026)
           ↓
BACKEND receives skillsConfig
           ↓
CodeAnyAgent.run() calls refreshSkillsForPrompt(prompt)
           ↓
Intent Predictor:
  1. Load all skills from disk (first time only, cached)
  2. Score each skill: count keyword matches
  3. Select top 5
  4. Register METADATA + CALLBACK with SDK
           ↓
Final prompt = SOUL + AGENTS + Memory + Workspace + Language + UserPrompt
  (✅ Includes skill registry, ❌ NOT full bodies)
           ↓
SDK query() runs model
  (If model invokes skill: SDK calls getPrompt() → full body injected)
```

---

## File Locations

### Frontend
```
src/config/index.ts
├─ API_PORT = 2026
└─ API_BASE_URL = "http://localhost:2026"

src/shared/hooks/useAgent.ts
└─ AGENT_SERVER_URL = API_BASE_URL (line 31)
```

### Backend - Server Setup
```
src-api/src/index.ts
├─ Entry point, port 2026
├─ Line 44-49: Local-only middleware (security)
├─ Line 60-61: Routes setup
├─ Line 175-177: Install built-in skills
├─ Line 185-186: Pre-populate skill cache
```

### Backend - API Routes
```
src-api/src/app/api/agent.ts
├─ POST / (line 166) — Direct execution
├─ POST /chat — Lightweight chat
├─ POST /plan — Planning only
├─ POST /execute — Execute plan (line 101)
└─ skillsConfig parameter (line 109-114)
```

### Backend - Service Layer
```
src-api/src/shared/services/agent.ts
├─ runAgent() (line 239) — Main execution
├─ runExecutionPhase() (line 185) — Plan execution
├─ runPlanningPhase() (line 161) — Planning only
└─ All receive skillsConfig and pass to agent
```

### Backend - Agent Implementation
```
src-api/src/extensions/agent/codeany/index.ts
├─ CodeAnyAgent class
├─ run() method (line 380)
├─ Line 416: Load system prompt (SOUL + AGENTS + Memory)
├─ Line 450: ✅ await refreshSkillsForPrompt(prompt)
└─ Line 453: Pass to SDK query()
```

### Backend - Skills Logic
```
src-api/src/shared/skills/predictor.ts
├─ refreshSkillsForPrompt() (line 167) ✅ MAIN FUNCTION
├─ loadAndCacheSkills() (line 65) — One-time load
├─ selectRelevantSkills() (line 130) — Scoring & selection
├─ scoreSkill() (line 112) — Keyword matching
└─ Line 179-187: registerSkill() calls

src-api/src/shared/skills/loader.ts
├─ loadAllSkills() — Load from filesystem
├─ loadSkillFromDir() — Parse single skill
├─ parseSkillFrontmatter() — Extract metadata
└─ installBuiltinSkills() — Setup

src-api/src/shared/skills/config.ts
├─ loadSkillsConfig() — Read ~/.htclaw/skills-config.json
├─ getDisabledSkills() — Get disabled list
└─ setSkillEnabled() — Toggle skill
```

---

## Execution Flow

### Step-by-Step

```
1. Browser POST /agent with { prompt, skillsConfig, ... }
   ↓
2. agent.ts:166-308 handles request
   └─ runAgent(prompt, session, conversation, ..., skillsConfig, ...)
   ↓
3. services/agent.ts:239-278 runAgent()
   └─ agent.run(prompt, { ..., skillsConfig, ... })
   ↓
4. extensions/agent/codeany/index.ts:380-496 CodeAnyAgent.run()
   ├─ Line 416: htclawSystemPrompt = getHTClawSystemPrompt(prompt)
   │  └─ (Loads SOUL.md, AGENTS.md, Memory)
   │
   ├─ Line 418: textPrompt = htclawSystemPrompt + ...
   │
   ├─ Line 450: await refreshSkillsForPrompt(prompt)  ← KEY LINE
   │  └─ Skill registry updated in SDK
   │
   └─ Line 453: for await (const message of query(...))
      └─ SDK receives prompt + skill registry
      └─ If model uses skill: SDK calls skill.getPrompt()
      └─ Full body injected at that point
   ↓
5. Browser receives SSE stream responses
```

### refreshSkillsForPrompt() In Detail

```
Input: prompt = "查询茅台的股价和K线"

1. await loadAndCacheSkills()
   ├─ First call: Load all SKILL.md files
   │  ├─ From ~/.claude/skills/
   │  └─ From ~/.htclaw/skills/
   ├─ Parse frontmatter for each
   ├─ Filter out disabled skills
   └─ Cache in cachedSkills[] (module level)
   
   Subsequent calls: No-op (return immediately)

2. const selected = selectRelevantSkills(prompt)
   ├─ For each cached skill:
   │  └─ score = count of keyword matches
   │
   │  Example:
   │  ├─ westock-quote: whenToUse = "股价,行情,K线,..."
   │  ├─ Score = 3 (matches: 股价, K线, ... in prompt)
   │  └─ Selected!
   │
   ├─ Sort by score descending
   ├─ Take top 5
   └─ If empty: return cold-start 3 skills

3. clearSkills() + for each skill: registerSkill(...)
   ├─ registerSkill({
   │  ├─ name: "westock-quote"        ← Metadata
   │  ├─ description: "腾讯行情..."    ← 30-60 chars
   │  ├─ whenToUse: "股价,行情,..."    ← Keywords
   │  ├─ argumentHint: "股票代码"      ← Optional
   │  └─ getPrompt: skill.getPrompt   ← CALLBACK FUNCTION
   │                 (not invoked yet)
   │  })

Output: SDK registry now has 1-5 skills registered with metadata + callbacks
```

---

## Data Structures

### CachedSkill (in memory after loadAndCacheSkills)

```typescript
interface CachedSkill {
  name: string;                          // "westock-quote"
  description: string;                   // "腾讯行情数据：实时价格、K线历史"
  whenToUse: string;                     // "股价,行情,现价,涨跌,K线,..."
  whenToUseKeywords: string[];           // ["股价", "行情", "现价", ...]
  argumentHint?: string;                 // "股票代码或名称"
  getPrompt: (args: string) => Promise<SkillContentBlock[]>;
    // Function containing closure over full SKILL.md content
}
```

### SkillContentBlock (returned by getPrompt)

```typescript
type SkillContentBlock = { type: 'text', text: string };

// When skill is invoked:
getPrompt("茅台") returns [{
  type: 'text',
  text: "---\nname: westock-quote\n...\n[FULL SKILL.md BODY]\n\n## User Arguments\n茅台"
}]
```

### skillsConfig (from frontend)

```typescript
skillsConfig?: {
  enabled: boolean;           // Master toggle
  userDirEnabled: boolean;    // Load from ~/.claude/skills/
  appDirEnabled: boolean;     // Load from ~/.htclaw/skills/
  skillsPath?: string;        // Custom path (optional)
}

// Currently received but NOT actively used for conditional logic
// (Future extensibility for selective loading)
```

---

## Scoring Algorithm Example

```
Prompt: "查询茅台的股价和K线"
Normalized: "查询茅台的股价和k线"

Skill 1: westock-quote
├─ whenToUse: "股价,行情,现价,涨跌,K线,日K,周K,均线"
├─ Keywords: ["股价", "行情", "现价", "涨跌", "k线", ...]
├─ Matches: 股价 ✓, K线 ✓
└─ Score: 2

Skill 2: 新闻搜索
├─ whenToUse: "新闻,资讯,快讯,头条"
├─ Keywords: ["新闻", "资讯", "快讯", "头条"]
├─ Matches: (none)
└─ Score: 0

Skill 3: 行情数据查询
├─ whenToUse: "行情,股价,指数,数据"
├─ Keywords: ["行情", "股价", "指数", "数据"]
├─ Matches: 股价 ✓
└─ Score: 1

Selected (Top 5):
1. westock-quote (score 2)
2. 行情数据查询 (score 1)
3-5. (other skills by score, or cold-start if no matches)
```

---

## Cold-Start Skills

When no skills match (all scores = 0), these 3 are always injected:

```typescript
const COLD_START_SKILL_NAMES = [
  '行情数据查询',      // iwencai stock quote — most common
  '新闻搜索',          // news search — second most common
  'westock-quote',     // tencent quote — covers price/chart
];
```

**Why**: First turn should always have useful tools available, even with ambiguous prompt.

---

## Token Budget

### System Prompt (before skills)
```
SOUL.md:           ~500-1000 chars (~125-250 tokens)
AGENTS.md:         ~1000-2000 chars (~250-500 tokens)
Memory:            ~500-2000 chars (~125-500 tokens)
Workspace:         ~300 chars (~75 tokens)
Language instr:    ~100 chars (~25 tokens)
────────────────────────────────────────────────────
Subtotal:          ~2500-5500 chars (~625-1375 tokens)
```

### Skills Registry (after refreshSkillsForPrompt)
```
5 skills × (name + 40-char desc + keywords + hint) ≈ 600 chars (~150 tokens)
+ getPrompt callbacks (pointers, negligible)
────────────────────────────────────────────────────
Subtotal:          ~600 chars (~150 tokens)

Total system + skills: ~3100-6100 chars (~775-1525 tokens)
```

### When Skill Invoked
```
User prompt:       ~100-1000 chars (~25-250 tokens)
Full SKILL.md:     ~1000 chars (~250 tokens)
────────────────────────────────────────────────────
Additional:        ~1100 chars (~275 tokens)
```

**Savings**: If skill not used → save ~250 tokens!

---

## Frontend Request Example

```typescript
// From src/shared/hooks/useAgent.ts

const response = await fetchWithRetry(`${AGENT_SERVER_URL}/agent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: userPrompt,
    modelConfig: { apiKey, baseUrl, model },
    sandboxConfig: { enabled: true, ... },
    skillsConfig: {
      enabled: true,
      userDirEnabled: true,
      appDirEnabled: true,
    },
    mcpConfig: { ... },
    language: language,
    conversation: conversationHistory,
    workDir: '~/my-project',
    taskId: 'task-123',
    images: attachedImages,
  }),
});

// Response is SSE stream
for await (const event of response) {
  // Handle: text, tool_use, tool_result, done, etc.
}
```

---

## Common Questions

### Q: Why not just load everything into the prompt?
**A**: Token efficiency. Full injection = ~3,750 tokens/turn. Dynamic = ~150 tokens/turn. Saves ~100 tokens if skill unused.

### Q: How does keyword matching work?
**A**: Split `whenToUse` by comma, normalize to lowercase, substring match in lowercase prompt. Count matches = score.

### Q: What if no skills match?
**A**: Return cold-start 3 skills (most common use cases). Ensures model always has basic tools.

### Q: Can I disable a skill?
**A**: Yes, edit `~/.htclaw/skills-config.json` or use API. Next session won't load it.

### Q: Can I add a custom skill?
**A**: Yes, create `~/.htclaw/skills/my-skill/SKILL.md` with frontmatter. Next session loads it.

### Q: Does the model know about all skills?
**A**: No. Model only knows about selected 1-5 skills (or 3 cold-start). This is intentional to keep context lean.

### Q: When is full SKILL.md body sent to model?
**A**: Only when model invokes the skill via the Skill tool. SDK calls `getPrompt()` at that moment.

### Q: Can I modify the scoring algorithm?
**A**: Yes, edit `scoreSkill()` in `src-api/src/shared/skills/predictor.ts`.

### Q: What's the difference between promptDescription and description?
**A**: `promptDescription` (30-60 chars) is injected into model context. `description` (longer) is UI-only.

---

## Deployment Notes

- **Port**: 2026 (configurable via PORT env var)
- **Security**: Local-only middleware blocks external access to `/agent/*` routes
- **Skills dir**: `~/.claude/skills/` (user), `~/.htclaw/skills/` (built-in)
- **Startup**: Server pre-populates skill cache on startup (line 185-186 of index.ts)
- **SDK**: Uses `@codeany/open-agent-sdk` v0.2.1

---

## Checklist for Understanding

- ✅ Full SKILL.md bodies are NOT injected every turn
- ✅ Only metadata (name, short description, keywords) are registered
- ✅ Full body is loaded on-demand via `getPrompt()` callback
- ✅ 1-5 skills selected per turn based on keyword scoring
- ✅ Cold-start 3 skills if no matches
- ✅ Backend: `/agent` endpoint at `http://localhost:2026`
- ✅ Service layer passes `skillsConfig` through to agent
- ✅ Agent calls `refreshSkillsForPrompt()` before `query()`
- ✅ Intent predictor in `/shared/skills/predictor.ts`
- ✅ Token savings: ~100-150 per turn if skill unused

