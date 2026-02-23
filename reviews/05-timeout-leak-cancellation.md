# Finding 05: Timeout Promise Memory Leak and No Cancellation

**Severity**: HIGH
**Consensus**: 4/6 reviewers
**File**: `agentloop/src/executor/scarlet-adapter.ts:76-82`

## Problem

When a timeout is set, `setTimeout` creates a timer that is never cleared if the agent completes in time. Additionally, when the timeout fires, the agent promise continues executing in the background, consuming API tokens and CPU indefinitely — `Promise.race` only ignores the loser, it doesn't cancel it.

## Recommendation

Store the timeout ID and clear it in a `finally` block. Use `AbortController` to cancel the underlying agent/LLM operation when the timeout fires.

## Implementation Plan

1. Store `setTimeout` return value; clear in `finally` block after `Promise.race`
2. Create an `AbortController` and pass its signal through to the agent
3. In LLM clients, pass the `AbortSignal` to `fetch()` calls
4. Check `signal.aborted` in streaming loops to exit early
