# Phase 1: Native LLM Client

## Goal

Build native LLM clients that talk directly to Anthropic and OpenAI-style APIs. This replaces the current approach of shelling out to OpenCode CLI and is the foundation for everything else.

## Why First

Every subsequent phase needs the ability to make LLM calls with tool use. Without this, nothing else works. This is the lowest-level building block.

## What to Build

### 1.1 — LLM Client Interface

**File:** `agentloop/src/llm/client.ts`

Define the provider-agnostic interface:

```typescript
interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  // text block
  text?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result block
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

interface LLMRequest {
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface LLMResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}
```

### 1.2 — Anthropic + OpenAI-Compatible Providers

**File:** `agentloop/src/llm/anthropic.ts`

Implement `LLMClient` using the Anthropic Messages API directly via `fetch` (no SDK dependency — keep the zero-runtime-dep philosophy):

- POST to `https://api.anthropic.com/v1/messages`
- API key from `ANTHROPIC_API_KEY` env var
- Handle rate limits with exponential backoff (3 retries)
- Handle API errors with structured error types
- Map request/response to our interface types

Also implement an OpenAI-compatible provider using the Chat Completions API:

- POST to `https://api.openai.com/v1/chat/completions` (or custom compatible base URL)
- API key from `OPENAI_API_KEY` env var
- Map tool definitions to OpenAI `tools[].function.parameters`
- Map OpenAI `tool_calls` back to internal `tool_use` blocks

### 1.3 — Provider Registry

**File:** `agentloop/src/llm/providers.ts`

Simple factory that resolves a provider name to an `LLMClient`:

```typescript
function createLLMClient(provider: string, config?: ProviderConfig): LLMClient
```

Registry resolves both `"anthropic"` and `"openai"`. The same pattern still allows adding OpenRouter/Ollama later without changing calling code.

### 1.4 — Configuration

**File:** Update `agentloop/src/types.ts`

Add LLM config to `AgentLoopConfig`:

```typescript
llm: {
  provider: string;       // "anthropic" | "openai"
  model: string;          // "claude-sonnet-4-5-20250929"
  maxTokens: number;      // 8192
  temperature: number;    // 0
}
```

**File:** Update `agentloop/src/config.ts`

Add defaults for LLM config. Read `ANTHROPIC_API_KEY` from env.

## Tests

**File:** `agentloop/tests/llm/client.test.ts`

- Test Anthropic provider constructs correct request payload
- Test response parsing maps to our types
- Test error handling (4xx, 5xx, network errors)
- Test rate limit retry logic
- Test missing API key throws clear error
- Test OpenAI tool-call mapping
- Use a mock HTTP server (or mock fetch) — no real API calls in tests

**File:** `agentloop/tests/llm/providers.test.ts`

- Test factory resolves "anthropic" and "openai"
- Test unknown provider throws

## New Dependencies

- None for runtime (use native `fetch` available in Node 22+)
- Consider `undici` mock or custom fetch mock for tests (or use Vitest's `vi.fn()`)

## Cleanup

- None yet. OpenCode adapter stays until Phase 3 replaces it.

## Definition of Done

- [x] `LLMClient` interface defined with full type coverage
- [ ] `AnthropicClient` makes real API calls (verified manually with a simple prompt)
- [x] Provider registry resolves `"anthropic"` and `"openai"`
- [x] Config schema extended with `llm` section
- [x] All tests pass (32 new tests, 74 total)
- [x] `pnpm build` succeeds
- [x] Existing tests still pass (no regressions)

## Files Created/Modified

- `src/llm/client.ts` — LLMClient interface, Message/ContentBlock types, LLMError
- `src/llm/anthropic.ts` — AnthropicClient with fetch, retry, error handling
- `src/llm/openai.ts` — OpenAI-compatible client with tool-call mapping
- `src/llm/providers.ts` — Provider registry (createLLMClient factory)
- `src/types.ts` — Added LLMConfig schema to AgentLoopConfig
- `src/config.ts` — Added llm defaults
- `tests/llm/anthropic.test.ts` — 26 tests
- `tests/llm/openai.test.ts` — OpenAI client and mapping tests
- `tests/llm/providers.test.ts` — 6 tests
