# Scarlet: Core Engine Architecture Brainstorm (v2)

## The Big Picture

```
You (human)                          Agent Box
─────────────                        ──────────────────────────────
Write PRD ──► Merge to main ──►      Poll/pull main
                                     Detect new PRD
                                     Create branch
                                     ┌─────────────────────────┐
                                     │   CORE ENGINE (this doc) │
                                     └─────────────────────────┘
                                     Push branch
                                     Create PR
                                     ◄── You review & merge
```

Everything below is about what happens inside that box.

---

## Core Design Principle: Separation of Concerns

**The human owns the WHAT and WHY.**
The PRD describes the feature, the acceptance criteria, architectural decisions, and constraints. It does not specify files, implementation approach, or task ordering. It is a product artifact, not an engineering plan.

**The agent owns the HOW and WHERE.**
The agent reads the codebase, understands its structure, conventions, and patterns, maps AC to concrete code changes, decomposes work into tasks, orders them by dependency, and executes. Over time, the agent builds cumulative knowledge about the codebase through its self-improvement system, making it faster and more accurate with every PRD it processes.

This separation matters because:
- The PRD never goes stale due to codebase drift — it doesn't reference files that might move
- The agent's codebase understanding is always current (it reads the code at execution time)
- The agent gets better over time — its knowledge compounds across PRDs
- You spend your time on product thinking, not implementation planning

---

## The PRD Format

A PRD is a markdown file dropped into a known directory (e.g. `docs/prd/`). It is purely a product/feature specification.

```markdown
# PRD: <feature-name>

## Summary
One paragraph describing the feature and why it matters.

## Acceptance Criteria
- [ ] AC-1: User can log in with email and password
- [ ] AC-2: Invalid credentials show an inline error message
- [ ] AC-3: Successful login redirects to the dashboard
- [ ] AC-4: Session persists across page reloads
- [ ] AC-5: Logout clears the session and redirects to login

## Constraints
- Must work without JavaScript disabled (progressive enhancement)
- Login endpoint must respond in < 200ms p95
- Must not introduce new runtime dependencies

## ADRs
### ADR-001: Session storage
Use HTTP-only cookies with signed JWTs. No server-side session store.
Rationale: Aligns with our stateless edge architecture on Cloudflare Workers.

### ADR-002: Form validation
Use zod schemas shared between client and server for validation.
Rationale: Single source of truth, already used elsewhere in the codebase.

## Notes
- Design reference: [link to figma or screenshot]
- Related existing code: the signup flow already handles similar form patterns
- This is a prerequisite for the "user profile" feature planned next
```

**What's NOT in the PRD:**
- No file paths
- No task decomposition
- No implementation steps
- No test file locations
- No dependency ordering

The `Notes` section can include hints ("the signup flow already handles similar form patterns") but these are suggestions, not instructions. The agent decides what to do with them.

---

## Part 1: The Execution Loop

### Phase Model

```
PRD lands
    │
    ▼
┌──────────────────────────────────────────────────────┐
│ PHASE 0: COMPREHENSION                               │
│                                                       │
│ Step 1 — EXPLORE: Read codebase structure, discover  │
│          patterns, conventions, relevant existing code │
│                                                       │
│ Step 2 — DECOMPOSE: Break AC into implementation     │
│          tasks with dependency ordering               │
│                                                       │
│ Step 3 — MAP: For each task, identify files to       │
│          create/modify, tests to write, risks        │
│                                                       │
│ Step 4 — VALIDATE: Sanity check the plan. Are there  │
│          contradictions? Missing pieces? Does the     │
│          dependency graph make sense?                  │
│                                                       │
│ Output: Implementation Plan (the agent's mini-spec)   │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│ PHASE 1: SCAFFOLDING                                  │
│ Create files, stubs, interfaces, test shells.         │
│ Output: compilable skeleton. Tests exist but fail.    │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│ PHASE 2: IMPLEMENTATION (the inner loop)              │
│ For each task in dependency order:                    │
│   evaluate → plan → code → test → commit              │
│ Output: working code, tests passing per task          │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│ PHASE 3: INTEGRATION VALIDATION                       │
│ Full test suite. Typecheck. Lint. Build.              │
│ Cross-task regression check.                          │
│ Output: all green, or targeted fix list               │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│ PHASE 4: SELF-REVIEW                                  │
│ Agent reviews its own diff against the PRD.           │
│ "Did I actually satisfy every AC?"                    │
│ "Did I introduce anything not in the PRD?"            │
│ Output: review notes, fix list, or LGTM               │
└──────────────────┬───────────────────────────────────┘
                   │
              ┌────┴────┐
              │ LGTM?   │
              └────┬────┘
             yes   │   no
              │    │    └──► back to Phase 2 (targeted)
              ▼
┌──────────────────────────────────────────────────────┐
│ PHASE 5: REFLECT                                      │
│ Extract skills, pitfalls, tools from this run.        │
│ Update knowledge store.                               │
│ Output: updated .scarlet/ knowledge base              │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
        Push branch + Create PR
```

---

### Phase 0: Comprehension

This is the most critical phase. The agent must go from a product-level PRD to a concrete implementation plan. It does this in four steps, each a separate LLM interaction with tool use.

#### Step 1: EXPLORE

The agent builds a mental model of the codebase. This isn't reading every file — it's strategic exploration guided by the PRD's subject matter.

**Process:**
1. Read the project's root structure (package.json, tsconfig, directory layout)
2. Query the knowledge store for existing skills/conventions about this codebase
3. Based on the PRD topic, identify which areas of the codebase are likely relevant
   - PRD mentions "login" → explore auth-related directories, existing forms, route definitions
4. Read relevant files to understand existing patterns
5. Build a structured map of what exists

**The agent uses tools for this:**
- `listDirectory` to understand structure
- `readFile` to examine key files
- `grep` to find references (e.g. "where are routes defined?")
- `findFiles` to discover test patterns, component patterns
- `querySkills` to retrieve learned knowledge from past runs

**Output:**

```typescript
interface CodebaseUnderstanding {
  // Project fundamentals (cached across runs, refreshed on change)
  project: {
    packageManager: string;          // pnpm, npm, yarn
    framework: string;               // react-router-v7, next, etc.
    language: string;                // typescript
    testFramework: string;           // vitest, jest
    buildTool: string;               // vite, tsup, etc.
    commands: {
      typecheck: string;
      lint: string;
      test: string;
      build: string;
    };
  };

  // Patterns discovered in this codebase
  conventions: {
    fileOrganization: string;        // "feature-based folders", "type-based folders"
    componentPattern: string;        // "function components with hooks", etc.
    testOrganization: string;        // "co-located", "__tests__ dirs", "tests/ root"
    importStyle: string;             // "path aliases @/", "relative", "barrel exports"
    stateManagement: string;         // "zustand", "context", "url state"
    dataFetching: string;            // "loaders/actions", "useEffect", "tanstack-query"
    errorHandling: string;           // "Result type", "try/catch", "error boundaries"
    validationApproach: string;      // "zod schemas", "manual", etc.
  };

  // Specific files/areas relevant to this PRD
  relevantCode: {
    path: string;
    purpose: string;                 // why this file matters for this PRD
    keyExports: string[];            // functions, types, components to be aware of
    patterns: string[];              // patterns used in this file the agent should follow
  }[];

  // Existing utilities the agent should reuse (not recreate)
  reusableCode: {
    path: string;
    name: string;
    description: string;             // what it does
    usage: string;                   // how to import/use it
  }[];
}
```

**Key insight: This understanding is partially cached.** The project fundamentals and conventions don't change between PRDs (usually). The knowledge store from previous runs already contains a lot of this. The agent should start with cached knowledge, then explore only what's new or changed. Over time, Step 1 gets faster because the agent already knows the codebase.

#### Step 2: DECOMPOSE

The agent breaks the PRD's acceptance criteria into implementation tasks. This is where the agent does the work that was previously baked into the PRD.

**Process:**
1. For each AC, determine what code changes are needed to satisfy it
2. Group related changes into tasks (an AC might need multiple tasks, or one task might satisfy multiple AC)
3. Identify dependencies between tasks (can't build the login form before the auth endpoint exists)
4. Order tasks topologically
5. Estimate complexity per task

**The agent must reason about:**
- What's the smallest useful unit of work? (Too big = hard to validate. Too small = too many context switches.)
- Which AC are independent? Which have implicit dependencies?
- Should infrastructure/plumbing come before features?
- What's the test strategy for each task?

**Output:**

```typescript
interface ImplementationPlan {
  tasks: {
    id: string;                      // generated: T-001, T-002, etc.
    title: string;
    description: string;             // detailed implementation intent
    satisfiesAC: string[];           // which AC this task addresses (can be partial)
    dependsOn: string[];             // task IDs this depends on
    filesToCreate: string[];         // new files
    filesToModify: string[];         // existing files to change
    tests: {
      file: string;                  // where the test goes
      description: string;           // what the test validates
      type: 'unit' | 'integration';
    }[];
    complexity: 'low' | 'medium' | 'high';
    risks: string[];                 // things that might go wrong
    relevantSkills: string[];        // skill IDs from knowledge store
    relevantPitfalls: string[];      // pitfall IDs to watch out for
  }[];

  // Verify completeness
  acCoverage: {
    ac: string;                      // the acceptance criterion
    coveredByTasks: string[];        // which tasks address it
  }[];

  // Decisions the agent made
  decisions: {
    decision: string;                // what was decided
    rationale: string;               // why
    alternatives: string[];          // what else was considered
  }[];
}
```

**The `acCoverage` field is critical.** It's a cross-reference proving every AC is addressed by at least one task. If an AC has no covering task, the plan is incomplete.

**The `decisions` field tracks ambiguity resolution.** When the PRD doesn't specify something and the agent has to decide, it records the decision here. These surface in the PR description so you can review them.

#### Step 3: MAP

For each task, the agent determines exactly which files are involved and what changes they need. This is more granular than Step 2 — it's the file-level implementation plan.

This step is where codebase knowledge really matters. The agent needs to know:
- Where do new components go in this project? (convention from knowledge store)
- What's the barrel export pattern? Do I need to update an index file?
- Where do tests go? Co-located or in a separate directory?
- Are there generators or templates I should use? (tools from knowledge store)
- What are the common mistakes in this area? (pitfalls from knowledge store)

#### Step 4: VALIDATE

The agent reviews its own plan before executing. A separate LLM call that acts as a sanity check:

- Does the dependency graph have cycles?
- Are there files being modified by multiple tasks in ways that might conflict?
- Does every AC have at least one task covering it?
- Are there implicit dependencies the agent missed? (e.g. task 3 modifies a file that task 2 creates, but task 3 doesn't depend on task 2)
- Is the task ordering logical? (infrastructure before features, types before implementations)
- Are the test expectations reasonable? (not testing implementation details)

If the validation finds issues, the agent revises the plan before proceeding.

**The implementation plan is committed to the branch** as the first commit (e.g. `.scarlet/plans/<prd-name>.json`). This gives you visibility into the agent's thinking before it starts coding.

---

### Phase 1: Scaffolding

Before implementing logic, create the skeleton based on the implementation plan from Phase 0:

- Create new files with proper exports, empty function bodies, correct types
- Create test files with `describe` blocks and `it.todo()` for each planned test
- Update barrel exports, route definitions, etc. as needed
- Ensure `tsc --noEmit` passes (everything compiles, even if functions throw or return stubs)
- Ensure the test runner can discover and skip all tests

**Why scaffold first?**

The agent gets a compilable baseline to work from. Each subsequent task can be validated independently. If task 5 breaks compilation, you know it's task 5's fault, not accumulated drift from tasks 1-4.

The scaffold also validates the plan from Phase 0. If the agent planned to create `src/components/LoginForm.tsx` but the import path doesn't resolve because the project uses a different alias structure, that surfaces here — before any logic is written.

Scaffold is committed as the second commit on the branch.

---

### Phase 2: Implementation (The Inner Loop)

For each task in dependency order:

```
┌──────────────────────────────────────────────────┐
│                  INNER LOOP                       │
│                                                   │
│  ┌─── EVALUATE ◄──────────────────────────────┐  │
│  │    Read current state of affected files     │  │
│  │    Read task definition from plan            │  │
│  │    Pull relevant skills + pitfalls           │  │
│  │    Check what prior tasks built              │  │
│  │                                              │  │
│  ▼                                              │  │
│  PLAN                                           │  │
│  │    Concrete changes to concrete files.       │  │
│  │    Ordered steps within this task.           │  │
│  │    What the tests should assert.             │  │
│  │                                              │  │
│  ▼                                              │  │
│  CODE                                           │  │
│  │    Make the changes.                         │  │
│  │    Keep changes scoped to this task.         │  │
│  │    Follow patterns from skills/conventions.  │  │
│  │                                              │  │
│  ▼                                              │  │
│  TEST                                           │  │
│  │    typecheck → lint → task tests → regress.  │  │
│  │                                              │  │
│  ▼                                              │  │
│  ┌─── ASSESS ─────────────────────────────────┐  │
│  │    All green? ──► COMMIT & next task        │  │
│  │    Failures?  ──► Classify error            │  │
│  │                   Feed context back ──► EVAL│  │
│  │    Max retries? ──► Log, flag, skip         │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

#### EVALUATE step

Before each task, the agent re-grounds itself. This prevents drift — the agent doesn't operate on stale assumptions.

1. Read the current state of all files this task will touch (they may have been modified by prior tasks)
2. Read the task definition from the implementation plan
3. Query knowledge store:
   - Skills matching this task's domain (form patterns, API patterns, etc.)
   - Pitfalls matching this task's risk areas
4. Read the last 3 entries from the progress log for continuity
5. If this is a retry: read the previous error output

#### PLAN step

The agent produces a concrete plan for this specific task. This is more granular than the Phase 0 plan — it's about the specific code changes within specific functions.

```
Task T-003: Implement login form component

Changes:
  1. src/components/auth/LoginForm.tsx — Create form with email/password
     fields, client-side validation via loginSchema (zod), submit handler
     that calls the auth action
  2. src/routes/auth.tsx — Add /login route pointing to LoginForm,
     add action function that validates credentials and sets session cookie
  3. src/components/auth/__tests__/LoginForm.test.tsx — Implement test
     stubs from scaffold: renders fields, validates input, handles submit

Patterns to follow:
  - Skill #12: "Form components use useActionData() for server errors"
  - Skill #7: "Zod schemas are defined in src/schemas/ and imported"

Watch out for:
  - Pitfall #3: "Don't use useEffect for form submission — use action functions"
  - Pitfall #8: "Remember to update route manifest after adding a route"
```

#### CODE step

The agent writes the actual code. Two approaches depending on context:

**New files:** Generate complete file content.
**Modifications:** Read the current file, produce targeted edits. The agent specifies what to change and why, not line numbers (which are brittle).

**Key constraints:**
- Only modify files listed in the task plan
- Don't refactor unrelated code (save that for a separate "refactor" PRD)
- Follow conventions from the knowledge store
- Reuse existing utilities — don't reinvent what already exists

#### TEST step

Run validation in this order with early exit on failure:

1. **Typecheck** (`tsc --noEmit`) — if types are broken, nothing else matters
2. **Lint** — no new violations
3. **Task tests** — the specific tests for this task's AC
4. **Regression** — previously passing tests still pass

Regression (step 4) is expensive but critical. It catches "fixed task 5 by breaking task 3." Optimization: only run regression on test files that touch files modified in this task.

#### ASSESS step

**All green →** Commit with structured message, update state, next task.

**Failures →** Classify the error:
- **Type error:** Usually a simple fix. Feed the error directly back.
- **Test assertion failure:** Logic bug. Feed the test expectation + actual result + relevant code.
- **Lint error:** Usually trivial (formatting, unused import). Feed back.
- **Regression failure:** Serious. The agent broke something from a prior task. Feed the failing test + the diff from this task so the agent can see what it changed.

Cap retries at 3-5 per task. If exceeded:
- Log the failure with full context (this becomes a pitfall candidate)
- Check if downstream tasks depend on this one
- If yes: skip the entire downstream subtree
- If no: skip just this task, continue

---

### Phase 3: Integration Validation

After all tasks complete (or are skipped), run the full gauntlet:

- Full test suite (not just task-specific tests)
- Full typecheck
- Full lint
- Production build
- Any custom validators defined in the PRD constraints (e.g. "< 200ms p95")

Integration issues caught here are cross-task problems. The agent gets a targeted fix cycle — same inner loop but scoped to the integration failure.

---

### Phase 4: Self-Review

A separate LLM call (ideally a different model for fresh perspective) that:

1. Reads the full `git diff main..current-branch`
2. Reads the original PRD
3. For each AC, checks it's addressed in the diff
4. Flags changes NOT motivated by the PRD (scope creep)
5. Checks for common AI code smells:
   - Dead code, unused imports
   - Over-abstraction (agent loves to create unnecessary abstractions)
   - Inconsistent naming
   - Missing error handling
   - Hardcoded values that should be config
   - Console.logs left behind
   - TODO comments from scaffolding that weren't resolved

Output is either LGTM or a fix list that goes back into Phase 2 as targeted tasks.

---

### Phase 5: Reflect

After a successful run, the agent extracts knowledge. This happens after the code is done but before the PR is created. Detailed in Part 2.

---

## Part 2: The Self-Improvement System

The agent observes its own execution and extracts reusable knowledge. This is what makes the agent get better over time, and what makes Phase 0 progressively faster and more accurate.

### Three Types of Learned Knowledge

#### 1. Skills (reusable patterns)

A skill is a codebase-specific pattern the agent discovered. Not generic coding knowledge — specific to THIS project.

```typescript
interface Skill {
  id: string;
  name: string;                  // e.g. "react-router-action-pattern"
  description: string;           // when to apply this skill
  trigger: string[];             // keywords/contexts that activate it
                                 // e.g. ["form", "action", "submit", "route"]
  content: string;               // the knowledge itself:
                                 //   - code template
                                 //   - step-by-step process
                                 //   - checklist
                                 //   - example from codebase
  projectSpecific: boolean;      // true = only this project. false = general
  confidence: number;            // 0-1, increases with successful reuse
  usageCount: number;
  lastUsed: string;              // ISO timestamp
  createdFrom: string;           // which PRD/task created this
  tags: string[];
}
```

**Examples of skills the agent might learn:**

- "When creating a new route, also update `src/routes.ts` manifest and add a nav entry in `src/config/navigation.ts`. Both use the same RouteConfig type."
- "This project uses a custom `useAsync` hook for data fetching. Import from `@/hooks/useAsync`. Don't use raw `useEffect` + `useState` for async operations."
- "Form components follow this pattern: [template with zod schema, useActionData, progressive enhancement]"
- "API error responses use the `ApiError` class from `@/utils/errors.ts`. Always wrap handler bodies in `withErrorHandling()`."
- "Tests for components that use loaders need to mock the loader using `createRoutesStub` from react-router."

**How skills are created (Phase 5):**

After a successful run, the agent reflects:
> "What did I have to figure out during this run that wasn't obvious? What patterns did I follow that future tasks would benefit from knowing upfront?"

The agent looks for:
- Patterns it applied across multiple tasks (suggests a convention)
- Things it had to discover by reading code (suggests undocumented knowledge)
- Boilerplate it repeated (suggests a template opportunity)

**How skills are consumed (Phase 0 + Phase 2 EVALUATE):**

During comprehension and before each task, the agent queries the skills database by topic. Matching skills are injected into context. This is RAG over the agent's own experience.

#### 2. Tools (executable automation)

A tool is something the agent builds to help itself. Unlike skills (knowledge), tools are scripts or templates it can run.

```typescript
interface AgentTool {
  id: string;
  name: string;                  // e.g. "scaffold-route"
  description: string;           // what it does and when to use it
  type: 'script' | 'template' | 'check';
  inputSchema: {                 // what arguments it takes
    [key: string]: {
      type: string;
      description: string;
      required: boolean;
    };
  };
  content: string;               // the script/template source
  usageCount: number;
  createdFrom: string;
  lastUsed: string;
}
```

**Examples:**
- A script that scaffolds a new route: creates component, test file, updates route manifest, adds barrel export
- A template for a new API action with standard error handling and validation
- A check that verifies all routes have corresponding test coverage

**When to create a tool:**
When the agent notices it performed the same multi-step mechanical process 3+ times across different tasks. The threshold prevents premature automation.

**How tools are consumed:**
During the PLAN step, the agent checks if any tools apply. If so, it invokes the tool first, then builds on top.

#### 3. Pitfalls (failure patterns to avoid)

A pitfall is a mistake the agent made and wants to avoid repeating.

```typescript
interface Pitfall {
  id: string;
  description: string;           // what went wrong
  context: string;               // what the agent was trying to do
  rootCause: string;             // why it went wrong
  avoidance: string;             // how to prevent it next time
  severity: 'low' | 'medium' | 'high';
  occurrences: number;           // times this has been hit
  createdFrom: string;           // which PRD/task
  lastTriggered: string;
  tags: string[];
}
```

**Examples:**
- "Tried to use `localStorage` in a loader function. Root cause: loaders run server-side in React Router v7. Avoidance: always check if code runs in a loader/action (server) vs component (client) before using browser APIs."
- "Tests failed because I imported from `src/utils` instead of `@/utils`. Root cause: project uses path aliases exclusively. Avoidance: always use `@/` prefix for imports, never relative paths beyond `./`."
- "Build failed after adding a dependency to package.json without running `pnpm install`. Avoidance: always run install immediately after modifying package.json."

**When to create a pitfall:**
Every time a task requires a retry due to a preventable error. The agent asks:
> "Would knowing this ahead of time have prevented the failure?"

If yes, extract it as a pitfall.

**How pitfalls are consumed:**
During EVALUATE, relevant pitfalls are surfaced as warnings injected into the task context. They act as "don't do this" guardrails.

### Knowledge Store Location

Stored in `.scarlet/` directory in the project repo:

```
.scarlet/
├── knowledge/
│   ├── skills.json              # learned patterns
│   ├── pitfalls.json            # failure patterns
│   └── tools/                   # executable tools
│       ├── scaffold-route.ts
│       └── ...
├── plans/                       # implementation plans from Phase 0
│   ├── login-feature.json       # plan for the login PRD
│   └── ...
├── runs/                        # execution logs
│   ├── 2026-02-22-login.log     # progress log
│   └── ...
└── context.md                   # project conventions summary
                                 # (auto-generated, human-editable)
```

**Why in the repo:**
- Version controlled — you can review what the agent learns
- Travels with the codebase
- Always in sync
- You can edit/delete skills if the agent learned something wrong

**`.scarlet/context.md`** is special. It's a generated summary of the project's conventions, patterns, and structure. The agent updates it after each run. It's the first thing loaded into context for every Phase 0. Think of it as the agent's institutional memory about this specific codebase. You can also manually edit it to correct or augment the agent's understanding.

### The Self-Improvement Loop

```
                    Run completes
                         │
                         ▼
               ┌─────────────────┐
               │    REFLECT      │
               │                 │
               │  Per task:      │
               │  - Did it pass  │
               │    first try?   │
               │  - Did I learn  │
               │    something?   │
               │  - Did I repeat │
               │    myself?      │
               └────────┬────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │  Skill?  │  │  Tool?   │  │ Pitfall? │
   │          │  │          │  │          │
   │ Non-obv  │  │ Repeated │  │ Required │
   │ pattern  │  │ mechanic │  │ a retry  │
   │ I had to │  │ process  │  │ due to   │
   │ figure   │  │ done 3+  │  │ prevent- │
   │ out      │  │ times    │  │ able     │
   └─────┬────┘  └─────┬────┘  │ error    │
         │              │       └─────┬────┘
         ▼              ▼             ▼
   ┌──────────────────────────────────────┐
   │         .scarlet/knowledge/          │
   │                                      │
   │  Queried at:                         │
   │  - Phase 0 (comprehension)           │
   │  - Phase 2 EVALUATE (per task)       │
   │  - Phase 2 PLAN (per task)           │
   └──────────────────────────────────────┘
         │
         ▼
   Future runs are smarter, faster,
   and make fewer mistakes.
```

### Knowledge Lifecycle

Skills and pitfalls aren't permanent. They have a lifecycle:

1. **Created** — confidence starts at 0.5
2. **Used successfully** — confidence increases (max 1.0)
3. **Used but didn't help** — confidence decreases
4. **Contradicted** — if a skill leads to a failure, flag it for review
5. **Stale** — if not used in N runs, demote. If the files it references no longer exist, archive.
6. **Archived** — not deleted, but not queried. Can be reviewed/restored.

**Pruning rule:** After each run, check for skills/pitfalls that reference files or patterns that no longer exist in the codebase. Archive them. This keeps the knowledge store in sync with the evolving codebase.

---

## Part 3: The Custom Coding Agent

The agent is the thing that actually talks to the LLM and executes tool calls. It's custom-built (not wrapping OpenCode) because we need full control over context management, model routing, and the knowledge system.

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     SCARLET ENGINE                          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │ PRD      │  │ Phase    │  │ Knowledge │  │ State    │ │
│  │ Detector │  │ Runner   │  │ Store     │  │ Manager  │ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────┬─────┘ │
│       │              │              │              │        │
│       └──────────────┼──────────────┼──────────────┘        │
│                      │              │                        │
│                      ▼              ▼                        │
│              ┌──────────────────────────┐                   │
│              │      CODING AGENT        │                   │
│              │                          │                   │
│              │  ┌──────────┐            │                   │
│              │  │ LLM      │            │                   │
│              │  │ Client   │◄─ model    │                   │
│              │  │ (BYOK)   │   routing  │                   │
│              │  └────┬─────┘            │                   │
│              │       │                  │                   │
│              │  ┌────▼─────┐            │                   │
│              │  │ Tool     │            │                   │
│              │  │ Runtime  │            │                   │
│              │  │          │            │                   │
│              │  │ - fs     │            │                   │
│              │  │ - shell  │            │                   │
│              │  │ - git    │            │                   │
│              │  │ - search │            │                   │
│              │  │ - know.  │            │                   │
│              │  └──────────┘            │                   │
│              │                          │                   │
│              │  ┌──────────┐            │                   │
│              │  │ Memory   │            │                   │
│              │  │ Manager  │            │                   │
│              │  └──────────┘            │                   │
│              └──────────────────────────┘                   │
│                                                             │
│  ┌──────────┐                                              │
│  │ Git /    │                                              │
│  │ GitHub   │                                              │
│  │ Client   │                                              │
│  └──────────┘                                              │
└────────────────────────────────────────────────────────────┘
```

### LLM Client (BYOK)

```typescript
interface LLMClient {
  complete(options: {
    messages: Message[];
    tools?: ToolDefinition[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse>;
}

interface LLMProvider {
  name: string;
  createClient(config: ProviderConfig): LLMClient;
}

// Provider implementations:
// - AnthropicProvider
// - OpenAIProvider
// - OpenRouterProvider (any model)
// - OllamaProvider (local)
```

### Model Routing

Different phases have different needs. Route accordingly:

| Phase | Need | Model tier |
|-------|------|-----------|
| Phase 0 Explore | Codebase analysis, pattern recognition | Strong reasoning (Opus, o3) |
| Phase 0 Decompose | Task decomposition from AC | Strong reasoning |
| Phase 0 Validate | Plan sanity check | Medium (Sonnet) |
| Phase 1 Scaffold | Boilerplate generation | Fast/cheap (Haiku, 4o-mini) |
| Phase 2 Plan | Per-task planning | Medium |
| Phase 2 Code (low complexity) | Simple implementation | Fast |
| Phase 2 Code (high complexity) | Complex logic | Strong |
| Phase 2 Assess | Error classification | Medium |
| Phase 4 Self-Review | Diff review against PRD | Strong (different provider than coder) |
| Phase 5 Reflect | Knowledge extraction | Strong reasoning |

Configured via a routing config:

```typescript
interface ModelRouting {
  default: ModelConfig;
  overrides: {
    phase: string;
    complexity?: 'low' | 'medium' | 'high';
    model: ModelConfig;
  }[];
}

interface ModelConfig {
  provider: string;        // "anthropic", "openai", "openrouter", "ollama"
  model: string;           // "claude-sonnet-4-5-20250929", etc.
  maxTokens: number;
  temperature: number;
}
```

### Tool Runtime

The agent's "hands" — how it interacts with the codebase and environment.

```typescript
interface AgentTools {
  // Filesystem
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  editFile(path: string, edits: FileEdit[]): Promise<void>;
  listDirectory(path: string, options?: { recursive?: boolean; depth?: number }): Promise<DirectoryEntry[]>;
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;

  // Shell
  exec(command: string, options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  // Search
  grep(pattern: string, options?: {
    paths?: string[];
    filePattern?: string;       // e.g. "*.tsx"
    maxResults?: number;
  }): Promise<{ file: string; line: number; content: string }[]>;

  findFiles(pattern: string, options?: {
    root?: string;
    ignore?: string[];          // e.g. ["node_modules", "dist"]
  }): Promise<string[]>;

  // Git
  gitDiff(base?: string): Promise<string>;
  gitCommit(message: string): Promise<string>;
  gitStatus(): Promise<{ modified: string[]; untracked: string[]; staged: string[] }>;

  // Knowledge store
  querySkills(query: string, limit?: number): Promise<Skill[]>;
  queryPitfalls(query: string, limit?: number): Promise<Pitfall[]>;
  queryTools(query: string): Promise<AgentTool[]>;
  saveSkill(skill: Omit<Skill, 'id'>): Promise<Skill>;
  savePitfall(pitfall: Omit<Pitfall, 'id'>): Promise<Pitfall>;
  saveTool(tool: Omit<AgentTool, 'id'>): Promise<AgentTool>;
  invokeAgentTool(toolId: string, input: Record<string, unknown>): Promise<string>;
}
```

### Memory Manager

Controls what the LLM sees in each interaction. Context window is finite — the memory manager prioritizes what matters.

```
┌──────────────────────────────────────────────────┐
│               MEMORY LAYERS                       │
│                                                   │
│  ┌─ Always Present (~2k tokens) ─────────────┐   │
│  │  System prompt (role, rules, constraints)  │   │
│  │  .scarlet/context.md (project conventions) │   │
│  │  Current phase + task definition            │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌─ Task-Scoped (~4-8k tokens) ──────────────┐   │
│  │  Implementation plan for current task       │   │
│  │  File contents (files being modified)       │   │
│  │  Matched skills + pitfalls                  │   │
│  │  Previous attempt errors (if retry)         │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌─ Session-Scoped (~1-2k tokens) ───────────┐   │
│  │  Progress: completed tasks (summary only)   │   │
│  │  Key decisions made so far                  │   │
│  │  Files created/modified (paths, not content)│   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌─ On Demand (agent pulls via tools) ───────┐   │
│  │  Specific file contents (readFile)          │   │
│  │  Search results (grep, findFiles)           │   │
│  │  Test output (exec)                         │   │
│  │  Git diff                                   │   │
│  └───────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

The bottom layer is key — the agent doesn't get everything in context. It uses tools to pull in what it needs. This is how you handle large codebases without blowing the context window.

The memory manager also handles **context summarization** for long runs. After every N tasks, it summarizes the session-scoped layer to prevent it from growing unbounded.

---

## Part 4: Open Questions (Revised)

### 1. How detailed should the PRD's acceptance criteria be?

Since the agent now owns decomposition, the AC quality directly determines output quality. Vague AC = vague implementation.

**Example of too vague:**
> "User can log in"

**Example of right level:**
> "User can log in with email and password. Invalid credentials show an inline error on the form (not a toast/alert). Successful login redirects to /dashboard. The session persists across page reloads for 7 days."

**Leaning:** AC should be testable statements. If you can't write a test assertion from it, it's too vague. The PRD doesn't need to specify HOW to test it, just WHAT the expected behavior is.

### 2. How does the agent handle large codebases?

Phase 0 can't read every file. For a 500-file project, the agent needs an efficient exploration strategy.

**Leaning:** Start with the directory tree and package.json. Use the PRD's subject matter to guide exploration (keywords → grep → targeted reads). Lean heavily on cached knowledge from previous runs. The first PRD against a new codebase will be slow. The tenth will be fast.

### 3. What if the agent's plan is wrong?

The implementation plan from Phase 0 might miss something or make a bad architectural choice. Should there be a human review gate?

**Options:**
- **A: No gate.** The agent runs autonomously. Bad plans surface as test failures. Self-review catches drift.
- **B: Optional gate.** The plan is committed and pushed. If you're watching, you can review it. If not, execution continues after a configurable delay.
- **C: Mandatory gate.** The plan is pushed as a draft PR. You approve before execution begins.

**Leaning:** Option B. Push the plan, wait 5 minutes (configurable). If no objection, proceed. This gives you the option to intervene without requiring it.

### 4. How does the agent handle PRD ambiguity?

When the PRD doesn't specify something the agent needs to decide:

1. Check if the codebase already does something similar → follow that pattern
2. Check skills database for relevant precedent → follow that
3. If neither helps → make a reasonable decision, document it in `decisions[]`
4. All decisions surface in the PR description

The agent never stops to ask. Autonomy is the priority. Bad decisions get caught in review.

### 5. What about PRDs that touch shared infrastructure?

Some PRDs might need to modify shared utilities, types, or configurations that other features depend on.

**Leaning:** The self-review phase should flag modifications to "high-impact" files (files imported by many other files). These get extra attention in the PR description. The agent can use `grep` to determine import fanout and flag accordingly.

### 6. Sequential PRD processing vs parallel?

**V1:** Sequential. One PRD at a time. Queue others.
**V2:** Parallel if PRDs don't touch overlapping files (determined by Phase 0 output). Each PRD gets its own branch.

---

## Part 5: What to Build First

### MVP (prove the loop works end-to-end)

1. PRD detection (poll git repo for new files in `docs/prd/`)
2. Phase 0: Codebase exploration + task decomposition (single LLM call with tool use)
3. Phase 2: Inner loop (evaluate → plan → code → test → assess)
4. Validation pipeline (typecheck + test runner)
5. State persistence + resume on crash
6. Git integration (branch, commit, push, create PR via GitHub API)
7. Single LLM provider (Anthropic)
8. Tool runtime (fs, shell, git, grep)

Skip for MVP: Phase 1 scaffolding, Phase 4 self-review, Phase 5 reflection, model routing, knowledge store. Just get the core loop producing a PR from a PRD.

### V1 (add intelligence)

9. Phase 0 multi-step (explore → decompose → map → validate)
10. Phase 1 scaffolding
11. Phase 4 self-review (separate model)
12. Knowledge store (skills + pitfalls)
13. Phase 5 reflection (extract skills/pitfalls after each run)
14. Knowledge consumption during Phase 0 + Phase 2
15. Model routing per phase
16. `.scarlet/context.md` auto-generation

### V2 (scale and polish)

17. Tool extraction (agent creates automation scripts)
18. Multiple LLM providers + BYOK config
19. Plan review gate (Option B — push plan, wait, then execute)
20. Progress dashboard / TUI
21. Cost tracking per PRD
22. Parallel PRD processing
23. Knowledge pruning and lifecycle management
24. PR description generation with decisions, coverage map, and flags
