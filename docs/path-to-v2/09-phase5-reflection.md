# Phase 9: Phase 5 — Reflection

## Goal

After a successful run, the agent extracts reusable knowledge from its experience. It identifies patterns it discovered, mistakes it made, and processes it repeated. This is what makes the agent get better over time.

## Depends On

- Phase 7 (Self-Review) — reflection happens after review
- Phase 8 (Knowledge Store) — reflection writes to the knowledge store

## What to Build

### 9.1 — Reflection Runner

**File:** `agentloop/src/reflection/reflection.ts`

```typescript
interface ReflectionOptions {
  prdName: string;
  tasks: Task[];                    // completed tasks with status/attempts
  plan: ImplementationPlan;
  diff: string;                     // full git diff
  progressLog: string;              // the run's progress log
  llmClient: LLMClient;
  knowledgeStore: KnowledgeStore;
}

interface ReflectionResult {
  skillsExtracted: Skill[];
  pitfallsExtracted: Pitfall[];
  toolCandidates: string[];         // descriptions of potential tools (not auto-created)
  contextUpdates: string[];         // updates to .scarlet/context.md
}

async function runReflection(options: ReflectionOptions): Promise<ReflectionResult>
```

### 9.2 — Reflection Prompt

**File:** `agentloop/src/reflection/prompts.ts`

The LLM is asked to analyze the run and extract knowledge:

**For skills:**
> What patterns did you apply that weren't obvious? What did you figure out by reading the codebase that future tasks would benefit from knowing upfront? What boilerplate did you repeat?

**For pitfalls:**
> Which tasks required retries? For each retry, what was the root cause? Would knowing this ahead of time have prevented the failure?

**For tool candidates:**
> Did you perform the same multi-step mechanical process multiple times? Describe it — don't build a tool yet (threshold is 3+ occurrences across runs).

### 9.3 — Deduplication

Before saving extracted knowledge, check for duplicates:
- Compare new skill triggers/content against existing skills
- If overlap > 80% → merge (update confidence, combine triggers)
- If new → save with confidence 0.5

### 9.4 — Context Update

After reflection, regenerate `.scarlet/context.md` with any new conventions discovered.

### 9.5 — Wire Into Executor

**File:** Update `agentloop/src/executor/executor.ts`

After self-review passes:
1. Run reflection
2. Save extracted knowledge
3. Update context.md
4. Push branch + create PR

## Tests

**File:** `agentloop/tests/reflection/reflection.test.ts`

- Mock LLM extracts skill from successful task → skill saved to store
- Mock LLM extracts pitfall from retried task → pitfall saved to store
- Duplicate skill detected → merged instead of duplicated
- Reflection with no retries → no pitfalls extracted
- Context.md updated after reflection

## Cleanup

- None. Additive phase.

## Definition of Done

- [ ] Reflection extracts skills from successful patterns
- [ ] Reflection extracts pitfalls from retried tasks
- [ ] Deduplication prevents duplicate skills/pitfalls
- [ ] Context.md regenerated after reflection
- [ ] Knowledge persisted to `.scarlet/knowledge/`
- [ ] All tests pass
- [ ] `pnpm build` succeeds
