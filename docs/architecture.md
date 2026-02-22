# Scarlet v2 Architecture

## System diagram

```text
PRD (v1/v2)
   |
   v
loader -> comprehension (v2/default) -> plan -> task list
   |                                      |
   |                                      v
   +-------------------------------> executor loop
                                          |
                                          +-> scaffold (new runs)
                                          +-> code + validation retries
                                          +-> self-review (+ fix cycles)
                                          +-> reflection
                                                  |
                                                  v
                                      .scarlet/knowledge + context.md
```

## Phase model and data flow

1. **Comprehension**
   - Inputs: PRD, codebase tools, model routing (`explore`, `decompose`).
   - Outputs: `CodebaseUnderstanding`, implementation plan, generated tasks.
2. **Scaffold**
   - Inputs: generated tasks + project metadata.
   - Outputs: starter files/tests before implementation.
3. **Execution**
   - Inputs: tasks in dependency order, layered memory, matched knowledge.
   - Outputs: code changes validated by pipeline (`typecheck -> lint -> test -> build`).
4. **Self-review**
   - Inputs: PRD content, acceptance criteria, git diff.
   - Outputs: approval + optional fix task list and review report.
5. **Reflection**
   - Inputs: final diff, task outcomes, progress log, plan coverage.
   - Outputs: persisted skills/pitfalls/tools and regenerated `.scarlet/context.md`.

## Module responsibilities

- `src/index.ts`: CLI entrypoint and command wiring (`run`, `comprehend`, `resume`, `status`, `init`).
- `src/prd/*`: format detection and parsing for v1/v2 PRDs.
- `src/comprehension/*`: explore/decompose/validate orchestration and plan persistence.
- `src/scaffold/*`: pre-implementation skeleton generation.
- `src/executor/*`: task loop, retries, validation integration, review/reflection orchestration.
- `src/review/*`: diff review prompts, review result formatting, fix-task generation.
- `src/reflection/*`: post-run knowledge extraction and persistence orchestration.
- `src/knowledge/*`: typed file-backed knowledge store (`skills`, `pitfalls`, `tools`) and context generation.
- `src/memory/*`: layered memory manager and token-budget prompt assembly.
- `src/llm/*`: provider clients (Anthropic + OpenAI-style) and phase-aware model routing.
- `src/tools/*`: file/search/shell/knowledge tools used by LLM phases.
- `src/state/*`: atomic run state persistence and append-only progress log.
- `src/validator/*`: sequential validation pipeline.

## Configuration reference

Configuration file path: `.agentloop/config.json` (project root).

Resolved order: `CLI overrides > config file > defaults`.

Top-level fields:

- `agent` (`"scarlet"`): active coding agent implementation.
- `maxAttempts` (number): max retries per task.
- `autoCommit` (boolean): commit passing tasks and scaffold/reflection artifacts.
- `branch` (string, optional): explicit branch name.
- `skipFailedDeps` (boolean): skip tasks with failed dependencies.
- `validationSteps` (array): ordered subset of `typecheck|lint|test|build`.
- `contextBudget` (number): memory prompt budget.
- `taskTimeout` (ms): per-agent attempt timeout.
- `validationTimeout` (ms): per-validation-step timeout.
- `dryRun` (boolean): print execution plan only.
- `verbose` (boolean): stream agent output.
- `llm`:
  - `provider` (`anthropic|openai`)
  - `model` (string)
  - `maxTokens` (number)
  - `temperature` (0-2)
- `modelRouting`:
  - `default` model config
  - `overrides[]` by phase and optional complexity (`low|medium|high`)

## Knowledge store format

Path root: `.scarlet/knowledge/`

- `skills.json`: array of skill entries (`id`, `name`, `description`, `trigger[]`, `content`, `confidence`, `usageCount`, `references[]`, etc.).
- `pitfalls.json`: array of pitfalls (`id`, `description`, `rootCause`, `avoidance`, `severity`, `occurrences`, `references[]`, etc.).
- `tools/*.json`: one file per tool candidate with type and content.
- `archive/`: archived stale entries and tool files.

Generated context file:

- `.scarlet/context.md`: consolidated project + conventions + learned skills context used during future runs.

## State file format

Execution state path: `.agentloop/state.json`.

Key fields:

- `prdFile`: absolute path to source PRD
- `startedAt`: run start timestamp
- `lastUpdated`: last mutation timestamp
- `currentTaskId`: active task ID or `null`
- `tasks[]`: runtime task snapshots (status, attempts, error, completion)
- `summary`:
  - `total`
  - `passed`
  - `failed`
  - `skipped`
  - `pending` (includes `pending` + `in_progress`)

State writes are atomic (`.tmp` + rename) to preserve crash-safe resumability.
