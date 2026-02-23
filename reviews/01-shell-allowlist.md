# Finding 01: Shell Denylist -> Allowlist

**Severity**: CRITICAL
**Consensus**: 6/6 reviewers
**File**: `agentloop/src/tools/shell-tool.ts:14-32`

## Problem

The shell tool uses a regex denylist (`DENIED_COMMAND_PATTERNS`) to block dangerous commands. This is a fundamentally broken security model — bypasses include double spaces (`rm  -rf /`), split flags (`rm -r -f`), case variations, subshell injection (`$(cmd)`), backticks, tab characters, and Unicode lookalikes.

## Recommendation

Replace the denylist with an allowlist of explicitly permitted command prefixes. Reject shell metacharacters that enable chaining/injection. Where possible, use `spawn` with `shell: false` to structurally prevent metacharacter injection.

## Implementation Plan

1. Define `ALLOWED_COMMANDS` — a set of known-safe base commands (git, npm, pnpm, yarn, node, npx, tsc, eslint, vitest, jest, cargo, python, rg, find, ls, cat, head, tail, wc, diff, mkdir, touch, cp)
2. Parse the command to extract the base binary name
3. Reject commands whose base binary is not in the allowlist
4. Reject commands containing unquoted shell metacharacters: `;`, `&&`, `||`, `|`, `$()`, backticks, `>`, `>>`
5. Add tests covering all known bypass vectors
