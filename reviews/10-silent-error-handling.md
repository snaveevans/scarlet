# Finding 10: Silent Error Swallowing / Inconsistent Error Handling

**Severity**: MEDIUM
**Consensus**: 4/6 reviewers
**Files**: `agentloop/src/executor/executor.ts:681-683`, `agentloop/src/comprehension/comprehension.ts:108-115`, `agentloop/src/reflection/reflection.ts:326`, `agentloop/src/prd/loader.ts`

## Problem

Multiple locations silently catch and discard errors:
- `executor.ts:681-683` — file load failures silently skipped
- `comprehension.ts:108-115` — invalid plans accepted with only `console.warn`
- `reflection.ts:326` — reflection updates silently dropped when `## Team Notes` marker is absent
- `loader.ts` — raw ENOENT without user-friendly message

## Recommendation

Replace silent failures with explicit logging or structured error propagation.

## Implementation Plan

1. `executor.ts`: Log skipped files at warning level via `progressLog`
2. `comprehension.ts`: Add `validationWarnings` field to `ComprehensionResult`
3. `reflection.ts`: If `replace()` didn't change the string, append a new `## Team Notes` section
4. `loader.ts`: Wrap `readFileSync` in try/catch with helpful error message
