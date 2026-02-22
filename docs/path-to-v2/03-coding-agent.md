# Phase 3: Coding Agent

## Goal

Build the coding agent — the component that takes a task prompt, makes LLM calls with tool use in a loop, and produces code changes. This replaces the OpenCode CLI shelling approach with a native agent loop.

## Depends On

- Phase 1 (LLM Client)
- Phase 2 (Tool Runtime)

## What to Build

### 3.1 — Agent Loop

**File:** `agentloop/src/agent/agent.ts`

The core agentic loop:

```typescript
interface AgentOptions {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolRegistry;
  llmClient: LLMClient;
  projectRoot: string;
  maxTurns?: number;        // default 30 — safety limit
  maxTokens?: number;       // per-turn max tokens
  onToolCall?: (name: string, input: unknown) => void;  // observability hook
  onResponse?: (response: LLMResponse) => void;         // observability hook
}

interface AgentResult {
  success: boolean;
  turns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCalls: { name: string; input: unknown; output: string }[];
  finalMessage: string;
  durationMs: number;
}

async function runAgent(options: AgentOptions): Promise<AgentResult>
```

**Loop logic:**
1. Send initial messages (system + user) with tool definitions
2. Get LLM response
3. If `stopReason === 'end_turn'` → done, return result
4. If `stopReason === 'tool_use'` →
   a. Execute each tool call via the tool registry
   b. Collect tool results
   c. Append assistant message + tool results to message history
   d. Go to step 2
5. If `stopReason === 'max_tokens'` → continue (send empty user message to get more)
6. If turns exceed `maxTurns` → stop, return with `success: false`

### 3.2 — New Agent Adapter

**File:** `agentloop/src/executor/scarlet-adapter.ts`

Implement the existing `AgentAdapter` interface using the new native agent:

```typescript
class ScarletAdapter implements AgentAdapter {
  name = 'scarlet';

  constructor(
    private llmClient: LLMClient,
    private tools: ToolRegistry,
  ) {}

  async execute(options: AgentExecuteOptions): Promise<AgentResult> {
    // Map AgentExecuteOptions to AgentOptions
    // Run the agent loop
    // Map AgentResult back to the executor's AgentResult type
  }
}
```

This is the bridge between the existing executor and the new agent. The executor doesn't change — it just gets a different adapter.

### 3.3 — Wire Into CLI

**File:** Update `agentloop/src/index.ts`

- Add `"scarlet"` as a valid `--agent` option
- Make `"scarlet"` the default agent
- Resolve `ScarletAdapter` when selected
- Keep `"opencode"` available as fallback during transition

### 3.4 — System Prompt

**File:** `agentloop/src/agent/prompts.ts`

Define the system prompt for the coding agent. This tells the LLM its role, constraints, and how to use tools:

```typescript
function buildSystemPrompt(context: {
  projectConventions?: string;  // from .scarlet/context.md (future)
  techStack?: string;
  testFramework?: string;
}): string
```

Key instructions in the system prompt:
- You are a coding agent. You modify files to satisfy the task.
- Use tools to read, understand, then modify code.
- Follow existing patterns in the codebase.
- Don't refactor unrelated code.
- Don't add unnecessary abstractions.
- When done, simply state what you changed.

## Tests

**File:** `agentloop/tests/agent/agent.test.ts`

Test the agent loop with a mock LLM client:

- Agent calls tools and processes results
- Agent stops on `end_turn`
- Agent respects `maxTurns` limit
- Agent tracks token usage
- Agent records tool call history
- Tool errors are sent back to LLM as `is_error: true` results

**File:** `agentloop/tests/executor/scarlet-adapter.test.ts`

- Adapter maps executor options to agent options
- Adapter maps agent result to executor result
- Adapter passes prompt correctly

### Integration Test

**File:** `agentloop/tests/integration/agent-executor.test.ts`

Run the full executor with a mock LLM that simulates writing a file:
1. Mock LLM responds with a `write_file` tool call
2. Agent executes the tool (in a temp directory)
3. Executor runs validation (skip validation for this test or use a trivial validator)
4. Task marked as passed
5. File actually exists on disk

This proves the full chain works: executor → adapter → agent → LLM → tool → filesystem.

## Cleanup

After this phase is verified working:

- **Do NOT delete** `opencode-adapter.ts` yet — keep as fallback option
- Mark OpenCode as deprecated in a code comment
- Update the `--agent` help text to recommend `scarlet`

## Definition of Done

- [ ] Agent loop runs LLM → tool → LLM cycles correctly
- [ ] `maxTurns` safety limit works
- [ ] Token usage tracked across turns
- [ ] `ScarletAdapter` plugs into existing executor without executor changes
- [ ] CLI defaults to `--agent scarlet`
- [ ] Integration test passes (mock LLM → real filesystem)
- [ ] All existing tests still pass
- [ ] `pnpm build` succeeds
