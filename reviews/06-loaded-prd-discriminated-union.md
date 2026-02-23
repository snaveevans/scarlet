# Finding 06: LoadedPRD Is Not a Discriminated Union

**Severity**: HIGH
**Consensus**: 1/6 reviewers
**File**: `agentloop/src/prd/loader.ts:9-14`

## Problem

`LoadedPRD` uses `v1?: PRD` and `v2?: PRDv2` optional fields rather than a proper discriminated union. TypeScript allows `loadedPrd.v1` to be accessed without checking `format === 'v1'` first — the compiler won't enforce the guard.

## Recommendation

Change to a proper discriminated union: `type LoadedPRD = { format: 'v1'; prd: PRD } | { format: 'v2'; prd: PRDv2 }`. Update all callers to use narrowed access.

## Implementation Plan

1. Change type definition in `loader.ts`
2. Update `loadPRD()` return values to use `{ format, prd }` shape
3. Update all callers to narrow on `format` before accessing `prd`
4. Compiler will catch any missed callers
