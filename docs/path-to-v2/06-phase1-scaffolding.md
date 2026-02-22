# Phase 6: Phase 1 — Scaffolding

## Goal

Add a scaffolding phase between comprehension and implementation. The agent creates file stubs, test shells, and interface definitions before writing any logic. This gives a compilable baseline to work from and validates the Phase 0 plan against reality.

## Depends On

- Phase 5 (PRD v2 Format) — scaffolding operates on the implementation plan from comprehension

## What to Build

### 6.1 — Scaffold Runner

**File:** `agentloop/src/scaffold/scaffold.ts`

```typescript
interface ScaffoldOptions {
  plan: ImplementationPlan;
  llmClient: LLMClient;
  tools: ToolRegistry;
  projectRoot: string;
  meta: PRDMeta;
}

interface ScaffoldResult {
  filesCreated: string[];
  testsCreated: string[];
  success: boolean;
  errors: string[];
}

async function runScaffold(options: ScaffoldOptions): Promise<ScaffoldResult>
```

**What the scaffold creates:**
1. New files from the plan with empty function bodies and correct types/exports
2. Test files with `describe` blocks and `it.todo()` for each planned test
3. Updates to barrel exports, route definitions, etc.

**Validation after scaffold:**
- Run `typecheck` — must pass (stubs compile even if they throw)
- Run test runner — tests should be discovered (all skipped/todo)

### 6.2 — Scaffold Prompt

**File:** `agentloop/src/scaffold/prompts.ts`

The scaffold prompt tells the LLM:
- Here is the implementation plan (task list with files to create/modify)
- Create all new files with proper exports, empty function bodies, correct type signatures
- Create test files with describe/it.todo blocks
- Do NOT implement any logic — only structure
- Ensure typecheck passes

### 6.3 — Wire Into Executor

**File:** Update `agentloop/src/executor/executor.ts`

Insert scaffold step between plan and task execution:
1. Parse PRD
2. Run comprehension → plan
3. **Run scaffold → compilable skeleton**
4. Commit scaffold
5. Run tasks (existing loop)

The scaffold commit is the second commit on the branch (after the plan commit from Phase 4).

## Tests

**File:** `agentloop/tests/scaffold/scaffold.test.ts`

- Mock LLM creates file stubs → files exist on disk
- Mock LLM creates test stubs → test files exist
- Scaffold result lists all created files
- Typecheck-like validation runs after scaffold (mock)

## Cleanup

- None. Additive phase.

## Definition of Done

- [x] Scaffold creates file stubs matching the plan
- [x] Scaffold creates test stubs with todo tests
- [x] Typecheck passes after scaffold (stubs compile)
- [x] Scaffold committed as its own commit
- [x] Implementation tasks can reference scaffolded files
- [x] All tests pass (255 total)
- [x] `pnpm build` succeeds
