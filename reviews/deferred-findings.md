# Deferred Findings (Post-V1)

These are real issues confirmed in the codebase but lower risk/impact. Safe to address after v1 release.

## Performance

- **FileKnowledgeStore per-call instantiation** (`tools/knowledge.ts`): A new store is created on every `execute()` call, cold-reading JSON from disk each time. Fix: inject as dependency via `ToolContext`.
- **O(n^2) in prune() and resolveExecutionOrder()** (`knowledge/file-store.ts:238`, `planner/dependency-graph.ts:59-63`): Use Set for ID lookup; use `.sort()` instead of insertion sort via `splice`.
- **FileKnowledgeStore full JSON read/write on every operation** (`knowledge/file-store.ts`): Add in-memory cache with dirty flag, write on `flush()` or exit.
- **Token estimation uses naive length/4** (`memory/memory-manager.ts:327-329`): Consider tiktoken or more conservative estimate.

## Code Quality / DRY

- **`truncate()` and `MAX_DIFF_CHARS` duplicated** (`review/prompts.ts`, `reflection/prompts.ts`): Move to `utils/markdown.ts`.
- **`parseRetryAfter` duplicated** (`llm/anthropic.ts:286-297`, `llm/openai.ts:361-372`): Extract to `llm/utils.ts`.
- **`similarity()`/`tokenize()` duplicated** (`reflection/reflection.ts:390-406`, `knowledge/file-store.ts:450-464`): Consolidate into `utils/similarity.ts`.
- **`DEFAULT_IGNORE` duplicated** (`tools/find-files.ts`, `tools/list-directory.ts`): Extract to `tools/constants.ts`.
- **LLM client duplication** (retry logic, error handling, sleep between `anthropic.ts` and `openai.ts`): Extract common patterns to shared module.

## Robustness

- **State manager has no file locking** (`state/state-manager.ts`): Unlikely concurrent runs in v1 usage. Add `proper-lockfile` if multi-process use becomes a pattern.
- **Memory management has no eviction** (`memory/memory-manager.ts`): Works fine under typical task sizes; add LRU if needed.
- **`appendFileSync` blocks event loop** (`state/progress-log.ts:33`): CLI context, not a server — acceptable for now.
- **Progress log has no rotation** (`state/progress-log.ts`): Implement size-based rotation if logs grow problematic.
- **Race condition in git branch creation** (`utils/git.ts`): Use `git checkout -B` for atomic create-or-switch.
- **File editing race condition** (`tools/edit-file.ts:73-77`): Add compare-and-swap with checksums if concurrent editors become an issue.
- **Missing retries on reflection/review phases** (`executor/executor.ts`): Transient LLM errors cause full run failure.

## Low-Risk Edge Cases

- **Prompt injection surface** (`agent/prompts.ts`): Acceptable for controlled-input developer tool.
- **`stripCodeFence` only handles json fences** (`utils/markdown.ts`): Change regex to `/^```\w*\s*\n?/` to match any language.
- **`globToRegex` doesn't handle `?`** (`tools/find-files.ts`): Add `?` to escaped chars and convert to `.`.
- **`sectionName` interpolated into RegExp** (`utils/markdown.ts`): Escape metacharacters before interpolation.
- **Unsafe CLI casts in `buildCliOverrides`** (`index.ts:458-477`): Add typeof guards or Zod validation.
- **Tool inputs use `Record<string, unknown>` without Zod** (all tool handlers): Define per-tool Zod schemas.
- **`afterEach` not in vitest import** (`tests/executor/executor.test.ts:1`): Works with `globals: true` but fragile.
- **Hardcoded magic numbers** (30 turns, 8k tokens, 150k threshold): Centralize in config.
- **Inconsistent error message patterns** (throughout codebase): Standardize on single pattern.
- **Build output not verified** (`package.json`): Add post-build check.
- **Zod `.default()` with side effects** (`prd/schemas.ts:37-38`): Use `.catch()` or explicit defaults.
- **API keys could be logged in verbose mode** (`executor/scarlet-adapter.ts:66-70`): Redact sensitive fields.
