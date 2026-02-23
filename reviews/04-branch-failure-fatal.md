# Finding 04: Branch Creation Failure Silently Swallowed

**Severity**: HIGH
**Consensus**: 1/6 reviewers (but critical impact)
**File**: `agentloop/src/executor/executor.ts:113-117`

## Problem

If `createAndCheckoutBranch` fails (git not installed, no repo, conflicting branch), the error is logged but execution continues on whatever branch is currently checked out — potentially `main`. All subsequent commits land on the wrong branch.

## Recommendation

Make branch creation failure fatal. After the catch block, verify the current branch matches the expected branch. If it doesn't, abort execution.

## Implementation Plan

1. In the catch block of `createAndCheckoutBranch`, re-throw the error as a fatal `ExecutorError`
2. Add a `getCurrentBranch()` utility to `utils/git.ts`
3. Add a post-checkout verification step
