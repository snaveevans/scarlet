# Phase 12: Cleanup and Documentation

## Goal

Remove all legacy code, clean up transitional shims, and document the final architecture. This is the last phase — everything should be working before this starts.

## Depends On

- All previous phases

## What to Clean Up

### 12.1 — Remove OpenCode Adapter

**Files to delete:**
- `agentloop/src/executor/opencode-adapter.ts`
- Any test files for opencode-adapter

**Files to update:**
- `agentloop/src/index.ts` — remove `"opencode"` from agent resolution, remove import
- `agentloop/src/types.ts` — remove `"opencode"` from agent config default/enum if present

### 12.2 — Remove Legacy PRD Format (Optional)

Decide: keep v1 PRD support or drop it?

**If dropping:**
- Delete `agentloop/src/prd/parser.ts` (v1 parser)
- Delete `agentloop/src/prd/schemas.ts` (v1 schemas, but check if types are used elsewhere)
- Delete `agentloop/tests/prd/parser.test.ts`
- Update `agentloop/src/prd/loader.ts` to only handle v2
- Remove `--format v1` from init command
- Delete `agentloop/templates/prd-template.md` (v1 template)

**If keeping:** Mark as legacy, keep working, no cleanup needed.

**Recommendation:** Keep v1 for now. It's useful for simple tasks where you want to specify tasks directly. Drop it later if it becomes a maintenance burden.

### 12.3 — Remove Legacy Root-Level Code

Evaluate whether root-level scripts and tests are still needed:

- `scripts/render-prd.mjs` — still useful? If PRD creation is handled by `agentloop init`, this may be redundant
- `scripts/validate-jsonl.mjs` — used for what? If not part of the v2 flow, remove
- `tests/render-prd.test.mjs` — remove if script removed
- `tests/validate-jsonl.test.mjs` — remove if script removed
- `schemas/scarlet.capture-item.schema.json` — used by anything? If not, remove
- Root `package.json` devDependencies (`ajv`, `ajv-formats`) — needed only if scripts above remain

### 12.4 — Remove Unused Dependencies

**File:** `agentloop/package.json`

Check if these are actually used:
- `pino` — imported anywhere? If not, remove
- `pino-pretty` — imported anywhere? If not, remove

### 12.5 — Clean Up Old Agent/Config Directories

Evaluate root-level directories:
- `agents/` — if this was for the old agent adapter pattern, remove
- `configs/` — if replaced by `.agentloop/config.json`, remove
- `systemd/` — still relevant for deployment? Keep or move to `deploy/`
- `docker/` — still relevant? Keep or move to `deploy/`

### 12.6 — Final Directory Structure

After cleanup, the project should look like:

```
scarlet/
├── agentloop/
│   ├── src/
│   │   ├── index.ts                    # CLI entry point
│   │   ├── config.ts                   # Configuration
│   │   ├── types.ts                    # Core types + Zod schemas
│   │   ├── llm/
│   │   │   ├── client.ts              # LLM client interface
│   │   │   ├── anthropic.ts           # Anthropic provider
│   │   │   ├── providers.ts           # Provider registry
│   │   │   └── routing.ts            # Model routing
│   │   ├── agent/
│   │   │   ├── agent.ts              # Core agent loop
│   │   │   └── prompts.ts            # System prompts
│   │   ├── tools/
│   │   │   ├── types.ts              # Tool interfaces
│   │   │   ├── registry.ts           # Tool registry
│   │   │   ├── read-file.ts          # File reading
│   │   │   ├── write-file.ts         # File writing
│   │   │   ├── edit-file.ts          # File editing
│   │   │   ├── list-directory.ts     # Directory listing
│   │   │   ├── search-files.ts       # Content search
│   │   │   ├── find-files.ts         # File finding
│   │   │   ├── shell.ts             # Shell execution
│   │   │   └── knowledge.ts         # Knowledge query tools
│   │   ├── prd/
│   │   │   ├── schemas.ts           # v1 schemas (legacy)
│   │   │   ├── schemas-v2.ts        # v2 schemas
│   │   │   ├── parser.ts            # v1 parser (legacy)
│   │   │   ├── parser-v2.ts         # v2 parser
│   │   │   ├── detect-format.ts     # Format detection
│   │   │   └── loader.ts            # Unified loader
│   │   ├── comprehension/
│   │   │   ├── comprehension.ts     # Phase 0 orchestrator
│   │   │   ├── explore.ts           # Codebase exploration
│   │   │   ├── decompose.ts         # AC → tasks
│   │   │   ├── validate-plan.ts     # Plan validation
│   │   │   └── plan-to-tasks.ts     # Plan → Task[] bridge
│   │   ├── scaffold/
│   │   │   ├── scaffold.ts          # Phase 1 scaffolding
│   │   │   └── prompts.ts           # Scaffold prompts
│   │   ├── executor/
│   │   │   ├── executor.ts          # Phase 2 execution loop
│   │   │   ├── agent-adapter.ts     # Adapter interface
│   │   │   └── scarlet-adapter.ts   # Native agent adapter
│   │   ├── validator/
│   │   │   └── validator.ts         # Validation pipeline
│   │   ├── review/
│   │   │   ├── self-review.ts       # Phase 4 self-review
│   │   │   ├── prompts.ts           # Review prompts
│   │   │   └── format-review.ts     # PR description formatter
│   │   ├── reflection/
│   │   │   ├── reflection.ts        # Phase 5 reflection
│   │   │   └── prompts.ts           # Reflection prompts
│   │   ├── knowledge/
│   │   │   ├── types.ts             # Knowledge types
│   │   │   ├── store.ts             # Store interface
│   │   │   ├── file-store.ts        # File-based implementation
│   │   │   └── context-generator.ts # context.md generation
│   │   ├── memory/
│   │   │   └── memory-manager.ts    # Layered context management
│   │   ├── state/
│   │   │   ├── state-manager.ts     # Atomic state persistence
│   │   │   └── progress-log.ts      # Append-only event log
│   │   ├── planner/
│   │   │   └── dependency-graph.ts  # Topological sort
│   │   └── utils/
│   │       ├── shell.ts             # Shell execution
│   │       └── git.ts               # Git operations
│   ├── tests/                        # mirrors src/ structure
│   ├── templates/
│   │   └── prd-v2-template.md
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── tsup.config.ts
├── docs/
│   ├── brainstorm-v2.md
│   ├── path-to-v2/                   # these planning docs
│   └── prd/
├── .scarlet/                          # generated at runtime
│   ├── knowledge/
│   │   ├── skills.json
│   │   └── pitfalls.json
│   ├── plans/
│   ├── runs/
│   └── context.md
└── README.md
```

## Documentation

### 12.7 — Update README.md

Comprehensive README covering:
- What Scarlet is (autonomous coding agent)
- Quick start (install, configure API key, write PRD, run)
- PRD format (v2 with examples)
- Configuration (config file, CLI flags, model routing)
- Knowledge system (skills, pitfalls, context.md)
- Architecture overview (phase diagram from brainstorm-v2)
- Development (how to build, test, contribute)

### 12.8 — Architecture Doc

**File:** `docs/architecture.md`

Technical architecture document:
- System diagram
- Phase model with data flow
- Module responsibilities
- Configuration reference
- Knowledge store format
- State file format

### 12.9 — .gitignore Update

Ensure `.scarlet/runs/` (execution logs) is gitignored but `.scarlet/knowledge/` and `.scarlet/context.md` are tracked.

## Tests

- Run full test suite — all tests pass
- Run `pnpm build` — clean build
- Manual smoke test: v2 PRD → comprehension → scaffold → implement → review → reflect → knowledge saved

## Definition of Done

- [ ] OpenCode adapter removed
- [ ] Unused dependencies removed
- [ ] Legacy root-level scripts evaluated and cleaned
- [ ] Directory structure matches final layout
- [ ] README.md comprehensive and accurate
- [ ] Architecture doc written
- [ ] .gitignore updated
- [ ] Full test suite passes
- [ ] Clean build
- [ ] Manual smoke test passes end-to-end
