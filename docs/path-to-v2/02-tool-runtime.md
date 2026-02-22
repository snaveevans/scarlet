# Phase 2: Tool Runtime

## Goal

Build the tool runtime — the set of tools the LLM can call during execution. These are the agent's "hands" for interacting with the codebase and environment.

## Depends On

- Phase 1 (LLM Client) — tool definitions use the `ToolDefinition` type

## What to Build

### 2.1 — Tool Interface

**File:** `agentloop/src/tools/types.ts`

```typescript
interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  execute(input: Record<string, unknown>, context: ToolContext): Promise<string>;
}

interface ToolContext {
  projectRoot: string;
  workingDir: string; // usually same as projectRoot
}

interface ToolRegistry {
  register(tool: ToolHandler): void;
  get(name: string): ToolHandler | undefined;
  list(): ToolHandler[];
  definitions(): ToolDefinition[]; // for LLM API calls
}
```

### 2.2 — Core Tools

Each tool is a separate file implementing `ToolHandler`:

**File:** `agentloop/src/tools/read-file.ts`
- Read file contents by path
- Return file content as string
- Error if file doesn't exist
- Support optional line range (offset + limit)

**File:** `agentloop/src/tools/write-file.ts`
- Write content to file path
- Create parent directories if needed
- Return confirmation message

**File:** `agentloop/src/tools/edit-file.ts`
- String replacement edit (old_string → new_string)
- Fail if old_string not found or not unique
- Support `replace_all` flag
- Return confirmation with context

**File:** `agentloop/src/tools/list-directory.ts`
- List directory contents
- Support recursive flag with depth limit
- Return formatted directory listing
- Ignore node_modules, .git, dist by default

**File:** `agentloop/src/tools/search-files.ts`
- Grep-like search using `child_process` to call `grep -rn` or `rg`
- Support file pattern filtering (e.g., `*.tsx`)
- Return matches with file path, line number, content
- Limit max results

**File:** `agentloop/src/tools/find-files.ts`
- Glob-based file finding
- Return matching file paths
- Ignore common directories

**File:** `agentloop/src/tools/shell.ts`
- Run shell command (wraps existing `utils/shell.ts`)
- Return stdout/stderr/exit code
- Enforce timeout
- Restrict to project root (no escaping)

### 2.3 — Tool Registry

**File:** `agentloop/src/tools/registry.ts`

- Register all core tools
- Expose as `ToolDefinition[]` for LLM API calls
- Dispatch tool calls by name
- Validate tool input against schema before execution

### 2.4 — Path Safety

All file/directory tools must enforce path safety:
- Resolve paths relative to `projectRoot`
- Reject paths that escape project root (e.g., `../../etc/passwd`)
- Reject access to `.git/` internals
- Allow access to `.scarlet/` (knowledge store)

## Tests

**File:** `agentloop/tests/tools/read-file.test.ts`
- Read existing file returns content
- Read nonexistent file returns error
- Read with line range returns correct subset
- Path traversal is rejected

**File:** `agentloop/tests/tools/write-file.test.ts`
- Write creates file with correct content
- Write creates parent directories
- Path traversal is rejected

**File:** `agentloop/tests/tools/edit-file.test.ts`
- Edit replaces matching string
- Edit fails on ambiguous match
- Edit fails on missing match
- replace_all replaces all occurrences

**File:** `agentloop/tests/tools/list-directory.test.ts`
- Lists directory contents
- Recursive listing respects depth
- Ignores default exclusions

**File:** `agentloop/tests/tools/search-files.test.ts`
- Finds matching content
- Respects file pattern filter
- Limits results

**File:** `agentloop/tests/tools/shell.test.ts`
- Runs command and returns output
- Respects timeout
- Returns exit code on failure

**File:** `agentloop/tests/tools/registry.test.ts`
- Registers and retrieves tools
- Generates ToolDefinition array
- Dispatches to correct handler
- Rejects unknown tool names

All tests use temp directories with fixture files. No real project modification.

## Cleanup

- None yet. These are all new files.

## Relationship to Existing Code

- `tools/shell.ts` wraps `utils/shell.ts` (existing) — don't duplicate, delegate
- The tool runtime is consumed by the coding agent (Phase 3), not by the executor directly

## Definition of Done

- [ ] All 7 core tools implemented with input validation
- [ ] Tool registry registers, lists, and dispatches
- [ ] Path safety enforced — traversal tests fail as expected
- [ ] All tests pass
- [ ] `pnpm build` succeeds
- [ ] Existing tests still pass
