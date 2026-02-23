# Phase 8: Knowledge Store

## Goal

Build the knowledge persistence system — skills, pitfalls, and tools that the agent accumulates over time. This is what makes the agent get smarter with every PRD it processes.

## Depends On

- Nothing — can be developed in parallel with Phases 1-3

## What to Build

### 8.1 — Knowledge Types

**File:** `agentloop/src/knowledge/types.ts`

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;       // when to apply
  trigger: string[];          // keywords that activate it
  content: string;            // the pattern/template/checklist
  projectSpecific: boolean;
  confidence: number;         // 0-1
  usageCount: number;
  lastUsed: string;           // ISO timestamp
  createdFrom: string;        // PRD name
  tags: string[];
}

interface Pitfall {
  id: string;
  description: string;        // what went wrong
  context: string;             // what the agent was doing
  rootCause: string;
  avoidance: string;           // how to prevent
  severity: 'low' | 'medium' | 'high';
  occurrences: number;
  createdFrom: string;
  lastTriggered: string;
  tags: string[];
}

interface AgentTool {
  id: string;
  name: string;
  description: string;
  type: 'script' | 'template' | 'check';
  inputSchema: Record<string, unknown>;
  content: string;             // script/template source
  usageCount: number;
  createdFrom: string;
  lastUsed: string;
}
```

Zod schemas for all three, for validation on read/write.

### 8.2 — Knowledge Store

**File:** `agentloop/src/knowledge/store.ts`

```typescript
interface KnowledgeStore {
  // Query
  querySkills(query: string, limit?: number): Skill[];
  queryPitfalls(query: string, limit?: number): Pitfall[];
  queryTools(query: string): AgentTool[];

  // Write
  saveSkill(skill: Omit<Skill, 'id'>): Skill;
  savePitfall(pitfall: Omit<Pitfall, 'id'>): Pitfall;
  saveTool(tool: Omit<AgentTool, 'id'>): AgentTool;

  // Lifecycle
  updateConfidence(skillId: string, delta: number): void;
  recordUsage(id: string, type: 'skill' | 'pitfall' | 'tool'): void;
  archive(id: string, type: 'skill' | 'pitfall' | 'tool'): void;
  prune(existingFiles: string[]): { archived: number };

  // Bulk read
  allSkills(): Skill[];
  allPitfalls(): Pitfall[];
  allTools(): AgentTool[];
}
```

### 8.3 — File-Based Implementation

**File:** `agentloop/src/knowledge/file-store.ts`

Persists to `.scarlet/knowledge/`:

```
.scarlet/
├── knowledge/
│   ├── skills.json
│   ├── pitfalls.json
│   └── tools/
│       ├── scaffold-route.ts
│       └── ...
├── context.md              // project conventions summary
└── plans/                  // from Phase 4
```

Implementation details:
- Read/write JSON files atomically (same pattern as state manager)
- Query uses simple keyword matching (trigger words, tags, description)
  - No vector DB in v1 — simple trigram or keyword overlap scoring
- IDs are auto-generated (e.g., `skill-001`, `pitfall-001`)
- Pruning checks if referenced file paths still exist in the codebase

### 8.4 — Context.md Generator

**File:** `agentloop/src/knowledge/context-generator.ts`

Generates/updates `.scarlet/context.md` — a human-readable summary of the project:

```typescript
function generateContext(understanding: CodebaseUnderstanding, skills: Skill[]): string
```

This file is loaded into every LLM prompt as always-present context. It's auto-generated but human-editable (edits are preserved on regeneration where possible).

### 8.5 — Knowledge Tools (for LLM)

**File:** `agentloop/src/tools/knowledge.ts`

Tools the LLM can call to query knowledge during execution:

- `query_skills` — search for relevant patterns
- `query_pitfalls` — search for known failure patterns

These register into the tool registry from Phase 2.

## Tests

**File:** `agentloop/tests/knowledge/store.test.ts`

- Save and retrieve skill
- Save and retrieve pitfall
- Query returns relevant results (keyword match)
- Query respects limit
- Update confidence adjusts value
- Record usage increments count and updates timestamp
- Archive removes from query results
- Prune archives skills referencing deleted files
- Corrupt JSON handled gracefully (backup + fresh start)

**File:** `agentloop/tests/knowledge/context-generator.test.ts`

- Generates context.md from understanding + skills
- Output includes project structure, conventions, key patterns

All tests use temp directories. No real `.scarlet/` modifications.

## Cleanup

- None. Entirely new subsystem.

## File Structure

```
agentloop/src/knowledge/
├── types.ts           # Skill, Pitfall, AgentTool interfaces + Zod schemas
├── store.ts           # KnowledgeStore interface
├── file-store.ts      # File-based implementation
└── context-generator.ts # .scarlet/context.md generation
```

## Definition of Done

- [x] Skills can be saved, queried, and retrieved
- [x] Pitfalls can be saved, queried, and retrieved
- [x] Knowledge persisted to `.scarlet/knowledge/` as JSON
- [x] Keyword-based query returns relevant results
- [x] Confidence lifecycle works (update, record usage)
- [x] Pruning archives stale entries
- [x] Context.md generated from understanding + skills
- [x] Knowledge tools available in tool registry
- [x] All tests pass (277 total)
- [x] `pnpm build` succeeds
