# Code Review: Scarlet / AgentLoop

## Executive Summary

Scarlet is a well-structured autonomous coding agent orchestrator with clear separation of concerns across its LLM abstraction, tool runtime, comprehension pipeline, execution loop, and knowledge system. The TypeScript is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Zod is used consistently for runtime validation of external data, and all 294 tests pass with clean typechecks. The architecture — phased pipeline from PRD comprehension through task execution, self-review, and reflection — is coherent and well-documented. However, there are security gaps in the shell tool (command injection), missing timeout enforcement in the agent adapter, substantial code duplication between parsing modules, and several robustness issues in LLM output handling that could cause silent failures in production.

---

## Findings

### Critical

#### 1. Shell Tool: No Command Sanitization — Command Injection Risk
- **Severity:** Critical
- **Location:** `agentloop/src/tools/shell-tool.ts:35-53`
- **Issue:** The `shell` tool passes LLM-provided command strings directly to `/bin/sh -c` via `runShellCommand()`. An LLM that has been prompt-injected (or one that simply hallucinates a dangerous command) can execute arbitrary shell commands: `rm -rf /`, exfiltrate data with `curl`, install malware, etc. There is zero sanitization, no allowlist, no denylist, and no sandboxing.
- **Recommendation:** At minimum, implement a denylist of dangerous commands/patterns (`rm -rf`, `curl`, `wget`, `chmod`, `sudo`, `dd`, etc.). Better: run commands in a sandboxed environment (Docker container, nsjail, or bubblewrap). Consider requiring explicit user approval for shell commands outside a safe set (test runners, linters, build tools). The `search_files` tool already uses `runShell` with explicit args — the shell tool should follow a similar pattern or at least warn the user about unrestricted execution.

#### 2. Agent Adapter Ignores `timeoutMs`
- **Severity:** Critical
- **Location:** `agentloop/src/executor/scarlet-adapter.ts:51-79`
- **Issue:** `AgentExecuteOptions.timeoutMs` is accepted as a parameter but never passed to `runAgent()`. The agent loop has no timeout mechanism at all — a stuck LLM call or infinite tool loop will hang forever, consuming API credits indefinitely. The `config.taskTimeout` (default 600s) is passed from the executor but silently ignored.
- **Recommendation:** Implement a timeout wrapper in either `ScarletAdapter.execute()` (using `Promise.race` with a timeout) or in `runAgent()` itself (checking elapsed time each turn). AbortController could be used to cancel in-flight fetch requests.

---

### High

#### 3. `safePath` Uses `require()` in ESM Module
- **Severity:** High
- **Location:** `agentloop/src/tools/types.ts:68`
- **Issue:** `safePath` uses `require('node:path')` inside a function body in an ESM module (`"type": "module"` in package.json). This works because Node.js creates `require` via `module.createRequire()` at the CJS compatibility layer, but it's fragile, non-idiomatic, and may break with future Node.js changes or stricter bundler configurations. The rest of the codebase correctly uses `import`.
- **Recommendation:** Replace with a static import at the top of the file: `import { resolve, relative } from 'node:path';`

#### 4. No Rate Limit Respect for Retry-After Headers
- **Severity:** High
- **Location:** `agentloop/src/llm/anthropic.ts:189-232`, `agentloop/src/llm/openai.ts:257-335`
- **Issue:** Both LLM clients retry on 429 (rate limit) with fixed exponential backoff (1s, 2s, 4s), but neither reads the `Retry-After` or `x-ratelimit-reset` headers from the response. This means the client may retry too aggressively (before the rate limit window resets), wasting API calls and potentially getting banned. Anthropic specifically documents `Retry-After` behavior.
- **Recommendation:** Parse `Retry-After` header from 429 responses and use `Math.max(backoff, retryAfterMs)` for the delay.

#### 5. Unbounded Memory Growth in Agent Loop Message History
- **Severity:** High
- **Location:** `agentloop/src/agent/agent.ts:95-191`
- **Issue:** The `messages` array in `runAgent()` grows unboundedly — every LLM response and tool result is appended. For complex tasks with many tool calls (the limit is 30 turns), this can accumulate massive message histories that exceed the model's context window. There is no truncation, summarization, or sliding window. The `maxTokens` config controls output tokens only, not input.
- **Recommendation:** Track cumulative input tokens (available from `response.usage.inputTokens`) and implement a strategy when approaching context limits — either summarize earlier messages or drop old tool results. At minimum, log a warning when input tokens exceed a threshold.

#### 6. Duplicate `extractSection` Functions
- **Severity:** High
- **Location:** `agentloop/src/prd/parser.ts:172-196`, `agentloop/src/prd/parser-v2.ts:152-176`
- **Issue:** The `extractSection()` function is independently implemented in both `parser.ts` and `parser-v2.ts` with identical logic. Similarly, `stripCodeFence()` is duplicated in `reflection.ts:423-428` and `self-review.ts:108-113`. This violates DRY and creates maintenance risk — a bug fix in one copy won't propagate.
- **Recommendation:** Extract shared utilities into a common module (e.g., `src/prd/utils.ts` for markdown parsing, `src/llm/parse-utils.ts` for JSON extraction from LLM output).

---

### Medium

#### 7. `git add -A` Stages Everything Including Secrets
- **Severity:** Medium
- **Location:** `agentloop/src/utils/git.ts:37`
- **Issue:** `stageAndCommit()` runs `git add -A`, which stages all changes in the working tree — including potential `.env` files, API keys, or other secrets that may have been created by the LLM-driven agent. There is no `.gitignore` verification or file filtering.
- **Recommendation:** Either verify that a `.gitignore` with common secret patterns exists before committing, or use a more targeted staging strategy (`git add` only the files listed in `task.files`). At minimum, check for files matching sensitive patterns (`.env*`, `*.key`, `*.pem`, `credentials.*`) before committing.

#### 8. Validation Pipeline Test Command is Vulnerable to Injection
- **Severity:** Medium
- **Location:** `agentloop/src/validator/validator.ts:107-108`
- **Issue:** The test command is built via string interpolation: `` `${framework} run ${testFiles}` ``. If a PRD contains malicious test file names (e.g., `"; rm -rf / #"`), this becomes shell injection because `runShellCommand` passes the whole string to `/bin/sh -c`. While the PRD is user-authored, the comprehension phase could generate such paths from LLM output.
- **Recommendation:** Use `runShell` with an explicit args array instead of `runShellCommand` with string interpolation, or sanitize the file paths against shell metacharacters.

#### 9. Knowledge Store Query Returns Items Even With Zero Score
- **Severity:** Medium
- **Location:** `agentloop/src/knowledge/file-store.ts:480-483`
- **Issue:** `rankResults` always returns at least 1 result (`Math.max(1, limit)`) even when all scores are 0 (no query tokens match). This means completely irrelevant knowledge entries get injected into agent prompts, wasting context budget and potentially confusing the model.
- **Recommendation:** Change to `Math.min(limit, ranked.length)` and only include items with `score > 0` (the filter on line 480 already handles empty queries).

#### 10. `buildMessages` Sends System Context as User Message
- **Severity:** Medium
- **Location:** `agentloop/src/memory/memory-manager.ts:193-206`
- **Issue:** `buildMessages()` wraps the system context in a user message (`role: 'user'`) prefixed with `## System\n`. The actual system prompt in the LLM request is set separately by the caller. This means the agent receives the system context twice — once in the system prompt slot (via `buildSystemPrompt`) and once as user content (via memory manager). This wastes context and creates conflicting instructions.
- **Recommendation:** Either use the memory manager as the sole source of system context (return it with `role: 'system'` or have the caller use it), or remove the system layer from `buildMessages`. The current approach is an artifact of the `messagesToPrompt` flattening in the executor.

#### 11. `messagesToPrompt` Loses Role Information
- **Severity:** Medium
- **Location:** `agentloop/src/memory/memory-manager.ts:317-325`
- **Issue:** `messagesToPrompt()` concatenates all messages with `\n\n` separators, discarding the `role` field entirely. The resulting flat string is passed to `runAgent` as `userPrompt`, which wraps it in a single user message. The LLM never sees the intended message structure — it's all one blob of text. This degrades model performance because the model can't distinguish system context from task instructions from user messages.
- **Recommendation:** Either pass the structured `Message[]` array through to the agent (modifying the interface), or at minimum preserve role markers: `[system]\n...\n[user]\n...`.

#### 12. No Concurrency Control for Tool Execution
- **Severity:** Medium
- **Location:** `agentloop/src/agent/agent.ts:159-185`
- **Issue:** When the LLM returns multiple tool_use blocks in a single response, they are executed sequentially in a for-loop. For independent operations (e.g., reading two different files), parallel execution would be faster. The Anthropic API supports parallel tool calls, but the agent doesn't take advantage of this.
- **Recommendation:** Use `Promise.all()` for tool calls that don't have dependencies on each other. For mixed read/write operations, sequential is safer — consider categorizing tools as read-only vs. mutating.

#### 13. `readFileSync` Used in Hot Paths
- **Severity:** Medium
- **Location:** Multiple files: `executor.ts:93`, `executor.ts:427`, `executor.ts:475`, `file-store.ts:376-378`
- **Issue:** Synchronous file reads (`readFileSync`) are used in the executor loop and knowledge store, which block the Node.js event loop. While this is acceptable during initialization, it's problematic in the hot execution path where it prevents concurrent I/O (e.g., the progress log, state persistence).
- **Recommendation:** Consider async alternatives (`readFile` from `fs/promises`) for the execution loop. Synchronous reads during startup/init are fine.

---

### Low

#### 14. Hardcoded `main` Branch for Diff Base
- **Severity:** Low
- **Location:** `agentloop/src/executor/executor.ts:433`
- **Issue:** `getDiffAgainstBase({ cwd: projectRoot }, 'main')` hardcodes `main` as the base branch. Projects using `master`, `develop`, or other trunk branches will get incorrect diffs for self-review.
- **Recommendation:** Make the base branch configurable in `AgentLoopConfig`, or auto-detect it via `git symbolic-ref refs/remotes/origin/HEAD`.

#### 15. Comprehension Retry Doesn't Feed Validation Errors Back
- **Severity:** Low
- **Location:** `agentloop/src/comprehension/comprehension.ts:82-111`
- **Issue:** When plan validation fails, `runComprehension` retries `runDecompose` but doesn't pass the validation errors to the next attempt. The LLM generates a new plan from scratch rather than fixing the specific issues found (e.g., "Task T-003 depends on unknown task T-999"). The decompose retry (line 106-107) in `decompose.ts` only handles JSON parse errors, not structural validation issues.
- **Recommendation:** Pass `validation.issues` into the decompose prompt on retry, e.g., "Your previous plan had these issues: ...". This would dramatically improve retry success rates.

#### 16. PRD Format Detection Has Ambiguous Cases
- **Severity:** Low
- **Location:** `agentloop/src/prd/detect-format.ts:6-25`
- **Issue:** A document with `# Project: X` but `## Acceptance Criteria` (no `## Tasks`) is detected as v1 because `hasProjectHeader` is checked first. The comment says "Prefer v1 when both styles appear" but a document could intentionally mix v1 project header with v2 AC-only workflow, and this isn't handled.
- **Recommendation:** Consider a stricter detection: require `# Project:` AND `## Tasks` for v1, `# PRD:` AND `## Acceptance Criteria` for v2, and throw for documents that have elements from both without a clear match.

#### 17. Scaffold Generates vitest-Only Test Stubs
- **Severity:** Low
- **Location:** `agentloop/src/scaffold/scaffold.ts:140-152`
- **Issue:** `buildTestStub` hardcodes `import { describe, it } from 'vitest'` regardless of the project's actual test framework (jest, mocha, node:test, etc.). While the `meta.testFramework` is available, it's not used for stub generation.
- **Recommendation:** Parameterize the test import based on `meta.testFramework`. For jest, the import is identical; for mocha, it differs; for `node:test`, it uses `import { describe, it } from 'node:test'`.

#### 18. Config Import Has Redundant Import
- **Severity:** Low
- **Location:** `agentloop/src/config.ts:3-4`
- **Issue:** Line 3 imports `AgentLoopConfig` as a value (the Zod schema), and line 4 imports the same name as a type. While TypeScript allows this, it's confusing — the value import shadows any expectation that `AgentLoopConfig` is type-only.
- **Recommendation:** Use `import type { AgentLoopConfig as AgentLoopConfigType }` consistently, or alias the Zod schema (e.g., `AgentLoopConfigSchema`).

#### 19. `overrideKey` Uses `*` as Wildcard String
- **Severity:** Low
- **Location:** `agentloop/src/llm/routing.ts:227-229`
- **Issue:** `overrideKey` uses `*` as the wildcard for undefined complexity, but this is a magic string that could conflict if someone names a complexity level `*`. The function is internal, so the risk is low.
- **Recommendation:** Use a more explicit sentinel like `__any__` or a Symbol, or document the `*` convention.

---

## Patterns Done Well

- **Zod for runtime validation:** Every external boundary (config files, LLM output, PRD parsing, state files) uses Zod schemas with `safeParse`, providing clear error messages and type safety at runtime. This is textbook correct.
- **Atomic file writes:** Both `StateManager` and `FileKnowledgeStore` use write-to-tmp-then-rename for crash safety. State corruption recovery with `.bak` files is thoughtful.
- **Provider-agnostic LLM abstraction:** The `LLMClient` interface cleanly separates provider specifics from business logic. Adding a new provider (e.g., Google Gemini) requires only implementing one interface.
- **Git utilities use spawn args, not string interpolation:** `git.ts` correctly passes branch names and commit messages as separate args to `spawn`, preventing shell injection via git operations. (Contrast with the `shell` tool which does not.)
- **Test quality:** 294 tests with good coverage of edge cases (path traversal, corrupt state recovery, empty inputs, LLM error handling). The mock LLM client pattern is well-designed for unit testing the agent loop.
- **Strict TypeScript config:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride` are enabled — stricter than most projects.

---

## Systemic Issues

1. **LLM JSON parsing is duplicated across 4 modules** (`explore.ts`, `decompose.ts`, `reflection.ts`, `self-review.ts`). Each independently strips code fences, parses JSON, and validates with Zod. A single `parseLLMJsonResponse<T>(raw: string, schema: ZodSchema<T>): T` helper would eliminate ~60 lines of duplication and ensure consistent error handling.

2. **No observability/telemetry beyond the progress log.** There's no way to track token usage per task, cost per run, or model performance metrics. The `TokenUsage` type exists in `client.ts` but is only used for cumulative tracking in the agent loop — per-phase and per-task breakdowns aren't recorded.

3. **The `messagesToPrompt` → flat string → single user message pipeline** defeats the purpose of structured multi-turn messaging. The memory manager carefully builds layered messages with priorities and token budgets, but then `messagesToPrompt` flattens everything into one string that gets stuffed into a single user message. This should be refactored so the agent receives properly structured `Message[]` arrays.
