# HTclaw Skills Processing Analysis Report

## Executive Summary

The HTclaw project implements a **dynamic, on-demand skill injection mechanism**. Skills are NOT fully loaded into the system prompt every turn. Instead, only **name/description/location** are registered with the SDK each turn, and the full SKILL.md body is retrieved on-demand via the skill's `getPrompt()` function.

---

## (1) AGENT_SERVER_URL Resolution

### Frontend Configuration
- **File**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app/src/config/index.ts`
- **Code**:
  ```typescript
  export const API_PORT = 2026;
  export const API_BASE_URL = `http://localhost:${API_PORT}`;
  ```

### Frontend Hook
- **File**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app/src/shared/hooks/useAgent.ts` (line 31)
- **Code**:
  ```typescript
  const AGENT_SERVER_URL = API_BASE_URL;  // = "http://localhost:2026"
  ```

### Result
✅ **AGENT_SERVER_URL = `http://localhost:2026`**

The frontend sends requests to `/agent` endpoint on this server (e.g., `http://localhost:2026/agent`).

---

## (2) Server-Side Code Location

### Main Entry Point
- **File**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app/src-api/src/index.ts`
- **Port**: 2026 (or via `PORT` environment variable)
- **Framework**: Hono (lightweight Node.js web framework)

### Agent API Routes
- **File**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app/src-api/src/app/api/agent.ts`
- **Main Endpoints**:
  - `POST /agent` — Direct execution (legacy, plan + execute in one call)
  - `POST /agent/chat` — Lightweight chat bypass
  - `POST /agent/plan` — Planning phase only
  - `POST /agent/execute` — Execution phase with plan ID
  - `POST /agent/title` — Generate title from prompt
  - `POST /agent/stop/:sessionId` — Stop a session
  - `GET /agent/session/:sessionId` — Check session status
  - `GET /agent/plan/:planId` — Retrieve stored plan

### Agent Service Layer
- **File**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app/src-api/src/shared/services/agent.ts`
- **Core Functions**:
  - `runAgent()` — Main execution path, receives `skillsConfig`
  - `runExecutionPhase()` — Execute a pre-made plan, receives `skillsConfig`
  - `runPlanningPhase()` — Create a plan (no execution)

### CodeAny Agent Implementation
- **File**: `/Users/nakocai/Documents/Projects/Start/HTclaw/htclaw-app/src-api/src/extensions/agent/codeany/index.ts`
- **Class**: `CodeAnyAgent extends BaseAgent`
- **Core Methods**:
  - `run()` — Execute directly (lines 380-496)
  - `plan()` — Create a plan (lines 498-563)
  - `execute()` — Execute a pre-made plan (lines 565-...)

---

## (3) Skills Processing: System Prompt Injection

### Request Flow

1. **Frontend sends `skillsConfig` in POST body**:
   ```typescript
   // From agent.ts line 109-114
   skillsConfig?: {
     enabled: boolean;
     userDirEnabled: boolean;
     appDirEnabled: boolean;
     skillsPath?: string;
   };
   ```

2. **Backend routes to service layer**:
   - `/agent` endpoint (line 292-305) → `runAgent(skillsConfig)`
   - `/agent/execute` endpoint (line 148-159) → `runExecutionPhase(..., skillsConfig)`

3. **Service passes to agent implementation**:
   - `agent.run()` receives `options.skillsConfig` (service.ts line 272)
   - `agent.execute()` receives `options.skillsConfig` (service.ts line 228)

### Critical: Dynamic Skill Injection Strategy

**What Gets Injected Each Turn:**

NOT the full SKILL.md body. Instead:

1. **Skill metadata** is registered with the SDK:
   - `name` (e.g., "westock-quote")
   - `description` (short: 30-60 chars, from `promptDescription` field)
   - `whenToUse` (comma-separated keywords for intent prediction)
   - `argumentHint` (optional user-facing hint)
   - `getPrompt()` callback (function, not body)

2. **Full SKILL.md body is lazy-loaded** via `getPrompt()` callback when skill is actually invoked

### Code Evidence: CodeAnyAgent.run() (lines 448-450)

```typescript
// Dynamically swap in only the skills relevant to this prompt
// so the model context stays lean each turn.
await refreshSkillsForPrompt(prompt);
```

This call happens **before `query()` is invoked** but **after system prompt is built**.

### The Intent Predictor: `/shared/skills/predictor.ts`

**Function**: `refreshSkillsForPrompt(prompt)` (lines 167-194)

#### Step 1: Load and Cache (one-time)
```typescript
await loadAndCacheSkills()  // First call loads all skills, subsequent calls are no-op
```

This populates a module-level cache:
```typescript
let cachedSkills: CachedSkill[] = [];  // Line 41

interface CachedSkill {
  name: string;
  description: string;      // Short description (~30-60 chars)
  whenToUse: string;          // Raw string: "股价,行情,K线,..."
  whenToUseKeywords: string[]; // Split + lowercased
  argumentHint?: string;
  getPrompt: (args: string) => Promise<SkillContentBlock[]>;  // LAZY-LOAD CALLBACK
}
```

#### Step 2: Select Relevant Skills by Intent
```typescript
const selected = selectRelevantSkills(prompt);  // Line 173
```

**Scoring Algorithm** (lines 112-120):
```typescript
function scoreSkill(skill: CachedSkill, normalizedPrompt: string): number {
  let score = 0;
  for (const kw of skill.whenToUseKeywords) {
    if (normalizedPrompt.includes(kw)) {
      score += 1;  // Increment for each keyword match
    }
  }
  return score;
}
```

**Selection Logic** (lines 130-154):
- Score all skills against the prompt
- Return top 5 by score
- If no matches, return cold-start baseline (3 skills: '行情数据查询', '新闻搜索', 'westock-quote')

#### Step 3: Register with SDK (NOT inject body)
```typescript
clearSkills();  // Line 176

for (const skill of selected) {
  registerSkill({
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    argumentHint: skill.argumentHint,
    userInvocable: true,
    allowedTools: ['Bash', 'Read', 'Write', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
    getPrompt: skill.getPrompt,  // LINE 186: This is a CALLBACK function
  });
}
```

**Key Insight**: `getPrompt` is a **function reference**, not evaluated yet. The SDK calls this callback when the skill is actually needed.

### How Full Content Gets Loaded

**File**: `/shared/skills/predictor.ts` (lines 86-89)

```typescript
const content = s.content;  // Full SKILL.md body loaded from filesystem

const getPrompt = async (args: string): Promise<SkillContentBlock[]> => {
  const contextNote = args ? `\n\n## User Arguments\n${args}` : '';
  return [{ type: 'text', text: content + contextNote }];  // On-demand injection
};
```

The full content is:
1. **Loaded from disk** at init time (line 85, from `LoadedSkill`)
2. **Cached in memory** as part of the `CachedSkill` closure
3. **Injected to SDK** only when `getPrompt()` is called by the SDK (when user invokes the skill)

---

## Summary Table

| Aspect | Answer |
|--------|--------|
| **Does full SKILL.md load every turn?** | ❌ No. Full body stays cached; only metadata is "registered" each turn. |
| **What gets injected into system prompt?** | ✅ Name, description (~40 chars), whenToUse (keywords), argumentHint |
| **When does full body get injected?** | ✅ Only when skill is invoked, via `getPrompt()` callback |
| **How many skills injected per turn?** | ✅ 1-5 matched skills (or 3 cold-start skills if no matches) |
| **Selection method** | ✅ Keyword scoring: split `whenToUse` by comma, count matches in prompt, sort |
| **SDK used** | ✅ `@codeany/open-agent-sdk` (registerSkill, clearSkills) |
| **Entry point** | `src-api/src/app/api/agent.ts` → `agent.post('/')` |
| **Agent implementation** | `src-api/src/extensions/agent/codeany/index.ts` → `CodeAnyAgent.run()` |
| **Skills selection logic** | `src-api/src/shared/skills/predictor.ts` → `refreshSkillsForPrompt()` |

---

## Code Path: Request to Response

```
Browser: POST http://localhost:2026/agent
  ↓
agent.ts:166 → agent.post('/', async (c) => {})
  ↓
Receives body with { prompt, skillsConfig, ... }
  ↓
services/agent.ts:239 → runAgent(prompt, session, conversation, ..., skillsConfig)
  ↓
extensions/agent/codeany/index.ts:380 → CodeAnyAgent.run(prompt, options)
  ↓
Line 416: const htclawSystemPrompt = await getHTClawSystemPrompt(prompt)
  [Loads SOUL.md + AGENTS.md + Memory — NOT skills]
  ↓
Line 418: const textPrompt = htclawSystemPrompt + getWorkspaceInstruction() + ...
  ↓
Line 450: await refreshSkillsForPrompt(prompt)
  [Only metadata + callbacks registered, NOT full bodies]
  ↓
Line 453: for await (const message of query({ prompt: finalPrompt, options: sdkOpts })) {
  [SDK has skill registry; calls getPrompt() if user invokes skill]
  ↓
Browser receives SSE stream with responses
```

---

## File Structure

```
htclaw-app/
├── src/                           # Frontend (React)
│   └── shared/hooks/useAgent.ts   # Line 31: AGENT_SERVER_URL = API_BASE_URL
├── src-api/                       # Backend (Node.js + Hono)
│   ├── src/index.ts               # Server entry, port 2026
│   ├── src/app/api/
│   │   └── agent.ts               # ✅ POST /agent endpoint (line 166)
│   ├── src/shared/services/
│   │   └── agent.ts               # Service layer: runAgent() (line 239)
│   ├── src/extensions/agent/
│   │   └── codeany/index.ts        # ✅ CodeAnyAgent.run() (line 380)
│   ├── src/shared/skills/
│   │   ├── loader.ts              # Load SKILL.md from ~/.claude/skills/
│   │   ├── predictor.ts           # ✅ refreshSkillsForPrompt() (line 167)
│   │   ├── config.ts              # Manage disabled skills
│   │   └── index.ts               # Aggregation
│   └── src/config/
│       └── prompt-loader.ts       # Load SOUL.md, AGENTS.md, Memory
└── [other files]
```

