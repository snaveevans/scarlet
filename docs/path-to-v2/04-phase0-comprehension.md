# Phase 4: Phase 0 — Comprehension

## Goal

Build the comprehension phase where the agent reads the PRD, explores the codebase, and decomposes acceptance criteria into implementation tasks. This is the brain of v2 — the agent now owns the HOW and WHERE.

## Depends On

- Phase 3 (Coding Agent) — uses the agent loop and tool runtime for exploration

## What to Build

### 4.1 — Comprehension Runner

**File:** `agentloop/src/comprehension/comprehension.ts`

Orchestrates the four steps of Phase 0:

```typescript
interface ComprehensionOptions {
  prd: PRDv2;              // the new AC-only PRD (but for now, extract AC from existing PRD)
  llmClient: LLMClient;
  tools: ToolRegistry;
  projectRoot: string;
  knowledgeStore?: KnowledgeStore;  // optional until Phase 8
}

interface ComprehensionResult {
  understanding: CodebaseUnderstanding;
  plan: ImplementationPlan;
  decisions: Decision[];
}

async function runComprehension(options: ComprehensionOptions): Promise<ComprehensionResult>
```

### 4.2 — Step 1: Explore

**File:** `agentloop/src/comprehension/explore.ts`

Uses the agent loop (with read-only tools) to build a mental model of the codebase:

```typescript
interface CodebaseUnderstanding {
  project: {
    packageManager: string;
    framework: string;
    language: string;
    testFramework: string;
    buildTool: string;
    commands: {
      typecheck?: string;
      lint?: string;
      test?: string;
      build?: string;
    };
  };
  conventions: {
    fileOrganization: string;
    testOrganization: string;
    importStyle: string;
  };
  relevantCode: {
    path: string;
    purpose: string;
    keyExports: string[];
  }[];
}
```

The LLM gets a prompt like:
> You are analyzing a codebase to prepare for implementing a feature. The feature is described as: [PRD summary]. Explore the codebase to understand its structure, conventions, and existing code relevant to this feature. Use the tools to read files and search for patterns.

Tools available: `read_file`, `list_directory`, `search_files`, `find_files` (read-only subset).

The LLM's response is parsed into the `CodebaseUnderstanding` structure.

### 4.3 — Step 2: Decompose

**File:** `agentloop/src/comprehension/decompose.ts`

Takes the PRD's acceptance criteria + codebase understanding and produces an implementation plan:

```typescript
interface ImplementationPlan {
  tasks: PlannedTask[];
  acCoverage: { ac: string; coveredByTasks: string[] }[];
  decisions: Decision[];
}

interface PlannedTask {
  id: string;                    // T-001, T-002, etc.
  title: string;
  description: string;
  satisfiesAC: string[];
  dependsOn: string[];
  filesToCreate: string[];
  filesToModify: string[];
  tests: { file: string; description: string }[];
  complexity: 'low' | 'medium' | 'high';
  risks: string[];
}

interface Decision {
  decision: string;
  rationale: string;
  alternatives: string[];
}
```

This is a single LLM call (not an agent loop — no tool use needed). The LLM gets:
- The PRD with acceptance criteria
- The `CodebaseUnderstanding` from Step 1
- Instructions to produce a structured JSON plan

The output is validated with Zod to ensure it's well-formed.

### 4.4 — Step 3+4: Map & Validate (Combined)

**File:** `agentloop/src/comprehension/validate-plan.ts`

A separate LLM call that reviews the plan for issues:
- Cycle detection in dependencies (also checked programmatically)
- Missing AC coverage
- Conflicting file modifications
- Logical ordering issues

Returns either approval or a list of issues. If issues found, feeds back to Step 2 for revision (max 2 iterations).

### 4.5 — Plan to Task Conversion

**File:** `agentloop/src/comprehension/plan-to-tasks.ts`

Converts `PlannedTask[]` to `Task[]` (the existing type the executor consumes):

```typescript
function planToTasks(plan: ImplementationPlan, meta: PRDMeta): Task[]
```

This is the bridge between the new comprehension system and the existing executor. The executor doesn't need to change — it still receives `Task[]`.

### 4.6 — Plan Persistence

**File:** Update `agentloop/src/state/state-manager.ts`

Save the implementation plan as the first commit on the branch:
- Write to `.scarlet/plans/<prd-name>.json`
- Commit with message `"plan: <prd-name> implementation plan"`

### 4.7 — Wire Into CLI

**File:** Update `agentloop/src/index.ts` and `agentloop/src/executor/executor.ts`

The `run` command flow becomes:
1. Parse PRD
2. **Run comprehension** → get `ImplementationPlan`
3. Convert plan to tasks
4. Run executor (existing loop, unchanged)

## Tests

**File:** `agentloop/tests/comprehension/decompose.test.ts`
- Mock LLM returns a valid plan → plan is parsed correctly
- Plan with missing AC coverage is flagged
- Plan with dependency cycles is caught
- Malformed LLM output triggers retry

**File:** `agentloop/tests/comprehension/validate-plan.test.ts`
- Valid plan passes validation
- Plan with cycles is rejected
- Plan with conflicting file modifications is flagged

**File:** `agentloop/tests/comprehension/plan-to-tasks.test.ts`
- Planned tasks convert to executor Task format
- Dependencies preserved
- File lists preserved
- Task IDs stable

**File:** `agentloop/tests/comprehension/explore.test.ts`
- Mock LLM explores codebase using tools
- Understanding structure is populated
- Handles projects with no config file gracefully

## Cleanup

- None yet. The old PRD parser still works for task-bearing PRDs. Both paths coexist.

## Definition of Done

- [x] Exploration step produces `CodebaseUnderstanding` from a real codebase (manual test)
- [x] Decomposition step produces `ImplementationPlan` from AC
- [x] Plan validation catches cycles and missing coverage
- [x] Plan converts to `Task[]` the executor can run
- [x] Plan committed to `.scarlet/plans/`
- [x] All tests pass (221 total, 75 new for Phase 4)
- [x] Full round-trip works: PRD → comprehension → executor → validation
- [x] `pnpm build` succeeds
- [x] Existing tests still pass
