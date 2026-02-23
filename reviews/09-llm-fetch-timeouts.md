# Finding 09: LLM Fetch Calls Have No Timeout

**Severity**: MEDIUM
**Consensus**: 2/6 reviewers
**Files**: `agentloop/src/llm/anthropic.ts`, `agentloop/src/llm/openai.ts`

## Problem

Both LLM clients use bare `fetch()` with no `AbortController`. A hung connection blocks execution indefinitely with no recovery path.

## Recommendation

Add `AbortController` with configurable timeout to all LLM fetch calls. Handle `AbortError` with a clear error message.

## Implementation Plan

1. Create `AbortController` with configurable timeout (default 5 min for streaming, 60s for non-streaming)
2. Pass `signal` to `fetch()` options in both clients
3. Handle `AbortError` in catch blocks with descriptive message
