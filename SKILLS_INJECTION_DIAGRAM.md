# Skills Injection Architecture Diagram

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER (React)                          │
│  POST http://localhost:2026/agent                               │
│  { prompt: "查询茅台股价", skillsConfig: {...} }                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              SERVER (src-api, Node.js + Hono)                   │
│                                                                  │
│  src-api/src/app/api/agent.ts                                   │
│  └─ agent.post('/', async (c) => {                             │
│     const body = await c.req.json<AgentRequest>();            │
│     const readable = createSSEStream(                          │
│       runAgent(                                                 │
│         prompt,                                                │
│         session,                                               │
│         conversation,                                          │
│         workDir,                                               │
│         taskId,                                                │
│         modelConfig,                                           │
│         sandboxConfig,                                         │
│         images,                                                │
│         skillsConfig,  ◄─── RECEIVES THIS                      │
│         mcpConfig,                                             │
│         language                                               │
│       )                                                         │
│     );                                                          │
│  })                                                             │
│                                                                  │
│  ↓ calls                                                         │
│                                                                  │
│  src-api/src/shared/services/agent.ts                           │
│  └─ export async function* runAgent(                           │
│       prompt: string,                                          │
│       session: AgentSession,                                   │
│       conversation?: ConversationMessage[],                    │
│       workDir?: string,                                        │
│       taskId?: string,                                         │
│       modelConfig?: ...,                                       │
│       sandboxConfig?: SandboxConfig,                           │
│       images?: ImageAttachment[],                              │
│       skillsConfig?: SkillsConfig,  ◄─── PASSES TO AGENT       │
│       mcpConfig?: McpConfig,                                   │
│       language?: string                                        │
│     ): AsyncGenerator<AgentMessage> {                          │
│       const agent = await getAgent(modelConfig);              │
│       for await (const message of agent.run(prompt, {         │
│         ...                                                    │
│         skillsConfig,  ◄─── PASSED HERE                        │
│         ...                                                    │
│       })) {                                                    │
│         yield message;                                        │
│       }                                                        │
│     }                                                           │
│                                                                  │
│  ↓ calls                                                         │
│                                                                  │
│  src-api/src/extensions/agent/codeany/index.ts                 │
│  └─ class CodeAnyAgent extends BaseAgent {                     │
│       async *run(                                              │
│         prompt: string,                                        │
│         options?: AgentOptions                                 │
│       ): AsyncGenerator<AgentMessage> {                        │
│         // Line 416: Load system prompt (SOUL + AGENTS + Memory)
│         const htclawSystemPrompt =                             │
│           await getHTClawSystemPrompt(prompt);                │
│                                                                │
│         // Line 418: Build initial prompt                      │
│         const textPrompt =                                     │
│           htclawSystemPrompt +                                │
│           getWorkspaceInstruction(...) +                      │
│           conversationContext +                               │
│           languageInstruction +                               │
│           prompt;                                             │
│                                                                │
│         // Line 450: ✅ THIS IS THE KEY MOMENT                │
│         await refreshSkillsForPrompt(prompt);                │
│                                                                │
│         // Line 453: Pass to SDK                               │
│         for await (const message of                           │
│           query({ prompt: finalPrompt, options: sdkOpts })   │
│         ) { ... }                                             │
│       }                                                        │
│     }                                                           │
│                                                                  │
│  ↓ calls                                                         │
│                                                                  │
│  src-api/src/shared/skills/predictor.ts                        │
│  └─ export async function refreshSkillsForPrompt(             │
│       prompt: string                                          │
│     ): Promise<void> {                                        │
│                                                                │
│       // STEP 1: One-time load (cached after first call)      │
│       await loadAndCacheSkills();                            │
│       // ↓ loads from ~/.claude/skills/ and ~/.htclaw/skills/│
│       // ↓ reads SKILL.md frontmatter for metadata            │
│       // ↓ splits whenToUse into keywords                     │
│       // ↓ creates getPrompt() closures                       │
│                                                                │
│       if (cachedSkills.length === 0) return;                  │
│                                                                │
│       // STEP 2: Score and select                             │
│       const selected = selectRelevantSkills(prompt);         │
│       // ↓ for each skill: count keyword matches in prompt   │
│       // ↓ sort by score descending                          │
│       // ↓ take top 5                                         │
│       // ↓ if empty, return cold-start 3 skills              │
│                                                                │
│       // STEP 3: Register with SDK (NOT inject full bodies)  │
│       clearSkills();  // Clear old registry                  │
│                                                                │
│       for (const skill of selected) {                         │
│         registerSkill({                                       │
│           name: skill.name,                    ◄─ Metadata   │
│           description: skill.description,      ◄─ 30-60 chars│
│           whenToUse: skill.whenToUse,           ◄─ Keywords  │
│           argumentHint: skill.argumentHint,    ◄─ Optional  │
│           userInvocable: true,                                │
│           allowedTools: [...],                               │
│           getPrompt: skill.getPrompt,           ◄─ CALLBACK  │
│                        ↑                                       │
│           This is a FUNCTION, not evaluated yet!             │
│         });                                                   │
│       }                                                        │
│     }                                                           │
│                                                                  │
│                                                                  │
│  MEMORY LAYOUT AT THIS POINT:                                  │
│  ──────────────────────────────────────────────────────────   │
│  cachedSkills (Module-level):                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [{                                                      │ │
│  │   name: "westock-quote",                               │ │
│  │   description: "腾讯行情数据：实时价格...",              │ │
│  │   whenToUse: "股价,行情,现价,涨跌,K线,...",             │ │
│  │   whenToUseKeywords: ["股价", "行情", ...],             │ │
│  │   getPrompt: async (args) => [{                        │ │
│  │     type: 'text',                                      │ │
│  │     text: "---\nname: westock-quote\n...[FULL BODY]"   │ │
│  │   }],  ◄─── Full SKILL.md stays in closure memory      │ │
│  │ },                                                     │ │
│  │ ...]                                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                  │
│  SDK Skill Registry (after registerSkill):                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [{                                                      │ │
│  │   name: "westock-quote",                               │ │
│  │   description: "腾讯行情数据：实时价格...",   (30 chars)│ │
│  │   whenToUse: "股价,行情,现价,...",         (keywords)   │ │
│  │   argumentHint: "股票代码或名称",                       │ │
│  │   getPrompt: Function(args) -> Promise[...] ◄─ Callback│ │
│  │ },                                                     │ │
│  │ ...]                                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Final Prompt passed to CodeAny SDK:                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [SOUL.md content]                 ◄─ ~500-1000 chars  │ │
│  │ [AGENTS.md content]                ◄─ ~1000-2000 chars│ │
│  │ [Memory snippets]                  ◄─ ~500-2000 chars │ │
│  │ [Workspace instruction]            ◄─ ~300 chars      │ │
│  │ [Language instruction]             ◄─ ~100 chars      │ │
│  │ [User prompt]                      ◄─ user input      │ │
│  │                                                         │ │
│  │ ❌ NOT IN PROMPT: Full SKILL.md bodies                │ │
│  │ ✅ IN SDK REGISTRY: Skill metadata + getPrompt()      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                  │
│  When user INVOKES a skill (e.g., via Skill tool):            │
│  ──────────────────────────────────────────────────────────   │
│  SDK calls: skill.getPrompt(userArgs)  ◄─ NOW injected       │
│  ↓                                                             │
│  Returns: [{                                                  │
│    type: 'text',                                             │
│    text: "[Full SKILL.md body + user arguments]"            │ │
│  }]                                                           │
│  ↓                                                             │
│  Model sees full content and can use the skill              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Points

### ❌ What Does NOT Happen

- ❌ Full SKILL.md bodies are NOT concatenated into system prompt every turn
- ❌ All ~15 skills are NOT injected each turn
- ❌ `formatSkillsForPrompt()` does NOT dump full bodies into context

### ✅ What DOES Happen

1. **At startup** (`src-api/src/index.ts:185-186`):
   - Call `loadAndCacheSkills()` once
   - Loads all SKILL.md files from disk into memory
   - Extracts frontmatter (name, description, whenToUse)
   - Splits `whenToUse` into keywords
   - Creates closures capturing full content

2. **Each conversation turn**:
   - Call `refreshSkillsForPrompt(userPrompt)`
   - Score cached skills: count keyword matches
   - Select top 5 (or 3 cold-start if no matches)
   - Call SDK's `clearSkills()` then `registerSkill()` for each selected
   - **Register only metadata + callback function**

3. **When skill is invoked**:
   - SDK calls skill's `getPrompt()` callback
   - Full content is injected into context
   - Model can use the skill

---

## Data Size Comparison

```
Scenario 1: ALL Skills Injected (hypothetical, not done)
├─ 15 skills × 1000 chars each = 15,000 chars ≈ 3,750 tokens
└─ Every turn (wasteful!)

Scenario 2: Only Metadata Registered (ACTUAL)
├─ SDK Registry:
│  ├─ 5 skills × 120 chars (name + 40-char description + keywords) = 600 chars
│  └─ getPrompt() functions (pointers, not content)
├─ System prompt: ~2,500-3,500 chars (SOUL + AGENTS + Memory + Workspace)
├─ User prompt: ~100-1000 chars
├─ Total: ~4,000-5,000 chars ≈ 1,000-1,250 tokens
├─ When skill invoked: full content added on-demand (~250-500 tokens)
└─ Result: Save ~100-150 tokens per turn if skill not used!

Scenario 3: Skill Actually Used
├─ Metadata (already in registry)
├─ Full SKILL.md body (added by getPrompt() callback)
├─ Total: Same as Scenario 1, but only when needed
```

---

## Request Body Format

```typescript
// Frontend sends this to POST /agent
{
  prompt: "查询茅台的股价和K线",
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  },
  sandboxConfig?: {
    enabled: boolean;
    provider?: string;
    apiEndpoint?: string;
  },
  skillsConfig?: {
    enabled: boolean;           // Feature toggle
    userDirEnabled: boolean;    // Load from ~/.claude/skills/
    appDirEnabled: boolean;     // Load from ~/.htclaw/skills/
    skillsPath?: string;        // Custom path (optional)
  },
  mcpConfig?: { ... },
  language?: string,
  conversation?: ConversationMessage[],
  workDir?: string,
  taskId?: string,
  images?: ImageAttachment[]
}
```

The backend extracts `skillsConfig` and passes it through the call chain, but **currently doesn't actively use it for conditional logic**. It's passed for future extensibility (e.g., "disable all skills", "use only user directory", etc.).

The actual skill selection is always based on `refreshSkillsForPrompt(prompt)`.

