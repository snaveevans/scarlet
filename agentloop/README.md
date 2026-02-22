# AgentLoop

Autonomous coding agent orchestrator. Wraps a coding agent CLI (OpenCode) in a structured execution loop — ingests a PRD, decomposes it into tasks, and executes each through the agent with automated validation gates.

## Prerequisites

- **Node.js >= 22** (see `engines` in `package.json`)
- **pnpm** (package manager)
- **OpenCode CLI** installed and available on your `$PATH` ([github.com/opencode-ai/opencode](https://github.com/opencode-ai/opencode)). AgentLoop spawns `opencode --non-interactive` for each task. If the CLI is missing you will see `ENOENT` errors at runtime.
- **Git** (required when `--auto-commit` is enabled, which is the default)

## Install

```bash
pnpm install
pnpm build
# Link globally so `agentloop` is available as a command
npm link
```

## Quick Start

```bash
# 1. Generate a PRD template in your target project
cd /path/to/your/project
agentloop init

# 2. Edit prd.md — fill in your project metadata and tasks
#    (see "PRD Format" below for the required structure)

# 3. Preview the execution plan
agentloop run ./prd.md --dry-run

# 4. Run for real
agentloop run ./prd.md --verbose
```

**What happens during a run:**

1. AgentLoop creates a `.agentloop/` directory in your project root containing `state.json` (resumable state) and `progress.log` (human-readable event log).
2. If `--auto-commit` is enabled (the default), a new git branch is created (`agentloop/<project-name>` or the name you pass with `--branch`).
3. Tasks are executed in dependency order. For each task, the agent receives a context-aware prompt, produces code, and then the validation pipeline runs (typecheck, lint, test, build).
4. On validation success the task is marked `passed` and auto-committed. On failure, the error output is fed back into the next agent attempt (up to `--max-attempts`).
5. After all tasks complete, a summary line is printed and logged.

## Usage

### Start a run

```bash
agentloop run ./prd.md
```

### Run with options

```bash
agentloop run ./prd.md \
  --max-attempts 5 \
  --auto-commit \
  --branch feature/my-feature \
  --verbose
```

### Resume an interrupted run

```bash
agentloop resume
```

### Check status

```bash
agentloop status
```

### Generate a PRD template

```bash
agentloop init
agentloop init --output ./docs/prd.md
```

### Dry run (show execution plan without running)

```bash
agentloop run ./prd.md --dry-run
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--max-attempts` | `3` | Max retry attempts per task before marking failed |
| `--auto-commit` | `true` | Git commit after each passed task |
| `--branch` | `agentloop/<prd-name>` | Git branch to work on |
| `--skip-failed-deps` | `true` | Skip tasks whose dependencies failed |
| `--validation-steps` | `typecheck,lint,test,build` | Comma-separated validation pipeline |
| `--agent` | `opencode` | Which coding agent adapter to use |
| `--dry-run` | `false` | Parse PRD and show execution plan without running |
| `--context-budget` | `12000` | Approx token budget for context injection per task |
| `--verbose` | `false` | Stream agent output to stdout in real time |

## PRD Format

AgentLoop requires a markdown PRD with a specific structure. Generate a template with `agentloop init`.

```markdown
# Project: My App

## Meta
- **Tech Stack:** React, TypeScript, pnpm
- **Test Framework:** vitest
- **Lint Command:** pnpm lint
- **Build Command:** pnpm build
- **Typecheck Command:** pnpm typecheck
- **Project Root:** ./

## Context
Brief architectural context injected into every task prompt.

## Tasks

### Task 1: Setup scaffold
- **ID:** T-001
- **Depends:** none
- **Files:** src/index.ts
- **Description:** Initialize project structure
- **Acceptance Criteria:**
  - Project builds
- **Tests:**
  - `src/__tests__/index.test.ts` — imports work
```

**Required fields per task:** `ID`, `Description`, and `Acceptance Criteria`. Everything else has sensible defaults (empty depends, empty files, empty tests).

**Key rules:**
- The `# Project: <name>` heading is required. The name is used for the default branch name.
- Task IDs must be unique (e.g. `T-001`, `T-002`).
- `Depends` references other task IDs. Use `none` for tasks with no dependencies.
- `Files` lists paths relative to the project root that the agent is expected to create or modify.
- `Tests` lists test file paths. These are passed to the test framework during validation. If a task has no tests the `test` validation step is skipped for that task.

## State & Progress

AgentLoop persists state to `.agentloop/state.json` and appends to `.agentloop/progress.log` in the target project root. If the process is interrupted, re-run `agentloop resume` to continue from where it left off.

### `state.json`

A JSON snapshot of the full run. Updated atomically (write-to-tmp + rename) after every state change. Key fields:

| Field | Description |
|-------|-------------|
| `prdFile` | Absolute path to the PRD that started this run |
| `startedAt` | ISO-8601 timestamp of when the run began |
| `lastUpdated` | ISO-8601 timestamp of the most recent mutation |
| `currentTaskId` | ID of the task being executed, or `null` between tasks |
| `tasks[]` | Full task list with live `status`, `attempts`, and `error` |
| `tasks[].status` | One of `pending`, `in_progress`, `passed`, `failed`, `skipped` |
| `tasks[].attempts` | How many times the agent has attempted this task |
| `tasks[].error` | Validation output from the most recent failed attempt |
| `summary` | Aggregate counters (`total`, `passed`, `failed`, `skipped`, `pending`) |

### `progress.log`

An append-only, human-readable log. Each line has the format:

```
[<ISO-8601 timestamp>] <message>
```

Example entries:

```
[2025-06-15T10:00:00.000Z] === AgentLoop started ===
[2025-06-15T10:00:01.000Z] PRD loaded: 5 tasks, 2 dependency chains
[2025-06-15T10:00:02.000Z] Git branch: agentloop/my-app
[2025-06-15T10:00:03.000Z] [T-001] STARTED: Setup scaffold
[2025-06-15T10:02:30.000Z] [T-001] VALIDATE: typecheck ✓ | lint ✓ | test ✓ | build ✓
[2025-06-15T10:02:30.000Z] [T-001] PASSED (attempt 1/3, 2m27s)
[2025-06-15T10:02:31.000Z] [T-001] COMMITTED: a1b2c3d "feat(T-001): Setup scaffold"
[2025-06-15T10:05:00.000Z] [T-002] RETRY (attempt 1/3): typecheck errors
[2025-06-15T10:08:00.000Z] [T-002] FAILED (max 3 attempts): lint errors
[2025-06-15T10:08:01.000Z] [T-003] SKIPPED: dependency failed
[2025-06-15T10:08:01.000Z] === Summary: 3/5 passed, 1 failed, 1 skipped ===
```

## Configuration

Optional `.agentloop/config.json` in your project root:

```json
{
  "agent": "opencode",
  "maxAttempts": 3,
  "autoCommit": true,
  "validationSteps": ["typecheck", "lint", "test", "build"],
  "contextBudget": 12000,
  "taskTimeout": 600000,
  "validationTimeout": 60000
}
```

Configuration is resolved with the following precedence (highest wins):
1. **CLI flags**
2. **Config file** (`.agentloop/config.json`)
3. **Built-in defaults**

## Validation Pipeline

After each agent attempt, tasks are validated through a sequential pipeline. The default order is `typecheck → lint → test → build`.

- **All steps are required.** If any step fails, the remaining steps are skipped (marked "Skipped due to earlier failure" in the log) and the attempt counts as a failure.
- **The `test` step is only run when the task declares test files.** If `tests` is empty, the step is omitted entirely.
- **Tests get 2× the normal timeout** (`validationTimeout * 2`).
- **When an attempt fails**, the error output from the first failing step is stored in `state.json` under `tasks[].error` and injected into the agent's next prompt so it can self-correct.

## Architecture

```
src/
├── index.ts               # CLI entrypoint (commander)
├── config.ts              # Config loading (defaults → file → CLI)
├── types.ts               # Shared types and zod schemas
├── prd/
│   ├── parser.ts          # Markdown PRD → structured PRD
│   └── schemas.ts         # Zod schemas for PRD/Task
├── planner/
│   └── dependency-graph.ts # Topological sort, cycle detection
├── executor/
│   ├── executor.ts        # Core execution loop
│   ├── agent-adapter.ts   # Abstract agent interface
│   └── opencode-adapter.ts # OpenCode CLI implementation
├── validator/
│   └── validator.ts       # Validation pipeline runner
├── state/
│   ├── state-manager.ts   # State persistence (.agentloop/state.json)
│   └── progress-log.ts    # Append-only log (.agentloop/progress.log)
└── utils/
    ├── shell.ts           # Shell command execution
    ├── context-builder.ts # Builds prompt per task
    └── git.ts             # Git branch/commit helpers
```

### Adding a new agent adapter

To support a coding agent other than OpenCode:

1. Create a new file in `src/executor/` (e.g. `my-agent-adapter.ts`).
2. Implement the `AgentAdapter` interface from `src/executor/agent-adapter.ts`:
   ```typescript
   import type { AgentAdapter, AgentExecuteOptions } from './agent-adapter.js';
   import type { AgentResult } from '../types.js';

   export class MyAgentAdapter implements AgentAdapter {
     readonly name = 'my-agent';

     async execute(options: AgentExecuteOptions): Promise<AgentResult> {
       // Spawn your agent CLI, pass options.prompt, capture output.
       // Return { success, stdout, stderr, durationMs }.
     }
   }
   ```
3. Register the adapter in `resolveAgent()` in `src/index.ts`.
4. Use it: `agentloop run ./prd.md --agent my-agent`.

### Adding a new validation step

Validation steps are defined in `src/validator/validator.ts` inside `buildPipeline()`. To add a new step:

1. Add the step name to the `validationSteps` enum in `src/types.ts`.
2. Add a corresponding command field to `PRDMeta` in `src/prd/schemas.ts`.
3. Add parsing logic for the new field in `src/prd/parser.ts`.
4. Add the pipeline entry in `buildPipeline()` in `src/validator/validator.ts`.

## Troubleshooting

### `ENOENT` error on first run

The `opencode` binary is not installed or not on your `$PATH`. Install OpenCode and verify with `which opencode`.

### PRD parsing fails

Ensure your PRD has the exact heading structure: `# Project: <name>`, `## Meta`, `## Context`, `## Tasks`. The project name heading is required. Run `agentloop init` to generate a valid template and compare.

### A task keeps retrying and failing

1. Check `.agentloop/progress.log` for the `RETRY` and `VALIDATE` lines to see which validation step is failing.
2. Open `.agentloop/state.json` and look at the `error` field on the failing task for the full validation output.
3. Consider running with `--verbose` to see the agent's live output and spot issues interactively.
4. If the task is fundamentally too complex for one pass, break it into smaller tasks in the PRD.

### Validation passes locally but fails in AgentLoop

AgentLoop runs validation commands in a subprocess from the project root. Check that the commands in your PRD `## Meta` section work when run from that directory (e.g. `cd /your/project && pnpm typecheck`).

### Resuming after a crash

Run `agentloop resume` from the project root directory (or with `--project-root <path>`). This reads `.agentloop/state.json` and continues from the first non-completed task. If state is corrupted, it is automatically backed up as `state.json.bak.<timestamp>` and a fresh run must be started.

### `--verbose` vs. the progress log

Use `--verbose` for **interactive debugging** — it streams the agent's raw stdout/stderr to your terminal in real time. Use the **progress log** for **post-run analysis** — it captures structured lifecycle events (started, validate, passed, failed, skipped, committed) with timestamps.

## Development

```bash
pnpm typecheck   # Type check
pnpm lint        # Lint
pnpm test        # Run tests
pnpm build       # Build dist/
```

## Contributing

1. Fork and clone the repository.
2. Create a feature branch from `main`.
3. Run `pnpm install` to install dependencies.
4. Make your changes. All source code is in `src/` and is written in TypeScript (ESM, target Node 22).
5. Ensure `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
6. Commit with a descriptive message and open a pull request.

Key conventions:
- **Zod schemas** are the source of truth for all data structures (PRD, Task, LoopState, Config). Types are inferred with `z.infer<>`.
- **State is persisted atomically** via write-to-tmp + rename. Never write state directly.
- **Shell commands are spawned without `shell: true`** where possible to avoid injection. See `src/utils/shell.ts` and `src/utils/git.ts`.
- **The validation pipeline fails fast** — if a required step fails, remaining steps are skipped.
