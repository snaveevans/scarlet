# Phase 11: Memory Manager

## Goal

Replace the simple context builder with a layered memory manager that controls what the LLM sees in each interaction. Context window is finite — the memory manager prioritizes what matters and uses tools for on-demand retrieval.

## Depends On

- Phase 3 (Coding Agent) — the memory manager feeds the agent loop

## What to Build

### 11.1 — Memory Layers

**File:** `agentloop/src/memory/memory-manager.ts`

```typescript
interface MemoryLayer {
  name: string;
  priority: number;          // higher = more important, kept first
  estimatedTokens: number;
  content: string;
}

interface MemoryManagerOptions {
  maxTokens: number;         // total context budget
  projectRoot: string;
  contextMd?: string;        // .scarlet/context.md content
}

interface MemoryManager {
  // Always-present layer (~2k tokens)
  setSystemContext(systemPrompt: string): void;
  setProjectContext(contextMd: string): void;
  setPhaseContext(phase: string, taskDef: string): void;

  // Task-scoped layer (~4-8k tokens)
  setTaskPlan(plan: string): void;
  setFileContents(files: { path: string; content: string }[]): void;
  setMatchedKnowledge(skills: Skill[], pitfalls: Pitfall[]): void;
  setPreviousError(error: string): void;

  // Session-scoped layer (~1-2k tokens)
  addCompletedTask(taskId: string, title: string, status: string): void;
  addDecision(decision: string): void;
  addModifiedFile(path: string): void;

  // Build final messages
  buildMessages(userPrompt: string): Message[];

  // Summarize session layer when it grows too large
  summarizeSession(): void;
}
```

### 11.2 — Token Budget Management

The memory manager prioritizes layers by importance:

1. **Always-present** — never trimmed
2. **Task-scoped** — trimmed last (most relevant to current work)
3. **Session-scoped** — trimmed first (summary, not detail)

When total exceeds budget:
1. Summarize session layer (compress completed tasks to one-liners)
2. Truncate file contents (keep first/last N lines)
3. Reduce matched knowledge (keep highest-confidence only)

### 11.3 — Replace Context Builder

**File:** Delete or gut `agentloop/src/utils/context-builder.ts`

The memory manager replaces the context builder entirely. All prompt construction goes through the memory manager.

Update all callers:
- `executor.ts` — use memory manager instead of `buildPrompt()`
- `comprehension.ts` — use memory manager for explore/decompose prompts
- `scaffold.ts` — use memory manager for scaffold prompt

### 11.4 — Session Summarization

When the session layer grows beyond its budget (e.g., after 10+ tasks), compress it:

```typescript
// Before summarization
"T-001 passed: Create user model with email, name, password hash fields"
"T-002 passed: Add bcrypt password hashing utility"
"T-003 passed: Create login endpoint with validation"
"T-004 failed: Add rate limiting to login (import error)"
"T-005 skipped: Add brute force detection (depends on T-004)"

// After summarization
"5 tasks processed: 3 passed (user model, password hashing, login endpoint), 1 failed (rate limiting - import error), 1 skipped"
```

## Tests

**File:** `agentloop/tests/memory/memory-manager.test.ts`

- Always-present layer included in every build
- Task-scoped layer included when set
- Session layer grows as tasks complete
- Token budget respected — layers trimmed in priority order
- Summarization compresses session layer
- File contents truncated when budget tight
- Messages built in correct order (system, context, user)
- Clear between tasks resets task-scoped layer

## Cleanup

- **Delete:** `agentloop/src/utils/context-builder.ts` (replaced by memory manager)
- **Delete:** `agentloop/tests/utils/context-builder.test.ts` (if it exists)
- Update all imports that referenced context-builder

## Definition of Done

- [ ] Memory manager builds messages with layered context
- [ ] Token budget enforced — layers trimmed by priority
- [ ] Session summarization compresses long runs
- [ ] Context builder fully replaced
- [ ] All callers updated to use memory manager
- [ ] All tests pass
- [ ] `pnpm build` succeeds
