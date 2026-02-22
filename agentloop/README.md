# AgentLoop

Autonomous coding agent orchestrator. Wraps a coding agent CLI (OpenCode) in a structured execution loop — ingests a PRD, decomposes it into tasks, and executes each through the agent with automated validation gates.

## Install

```bash
pnpm install
pnpm build
# Link globally
npm link
```

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

## State & Progress

AgentLoop persists state to `.agentloop/state.json` and appends to `.agentloop/progress.log` in the target project root. If the process is interrupted, re-run `agentloop resume` to continue from where it left off.

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

CLI flags override config file values.

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

## Development

```bash
pnpm typecheck   # Type check
pnpm lint        # Lint
pnpm test        # Run tests
pnpm build       # Build dist/
```
