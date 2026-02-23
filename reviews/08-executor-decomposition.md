# Finding 08: Executor Decomposition

**Severity**: MEDIUM
**Consensus**: 5/6 reviewers
**File**: `agentloop/src/executor/executor.ts` (827 lines)

## Problem

`executeStateTask` and `executeReviewFixTasks` share ~80% identical logic: resolve adapter, set up memory, call agent, handle retries/skipped, update state, run validation, log progress. This 500+ line DRY violation compounds maintenance burden.

## Recommendation

Extract a shared `runTaskExecution(task, options)` function parameterized by task type and post-execution hooks. Both callers reduce to setup + `runTaskExecution()` call.

## Implementation Plan

1. Identify the common execution pattern between `executeStateTask` and `executeReviewFixTasks`
2. Extract into `runTaskExecution(task, options)` with configurable hooks
3. Refactor both callers to use the shared function
4. Verify all existing tests still pass
