# Finding 03: safePath Symlink Escape and Platform Gaps

**Severity**: HIGH
**Consensus**: 4/6 reviewers
**File**: `agentloop/src/tools/types.ts:68-84`

## Problem

`safePath` checks path containment using `path.relative()` but does not resolve symlinks first. A symlink inside the project root pointing to `/etc/passwd` would pass validation. Additionally, null bytes in paths and Windows drive-letter absolute paths are not checked.

## Recommendation

Resolve symlinks with `fs.realpathSync` before the containment check. Reject paths containing null bytes. Add platform-aware checks for Windows paths.

## Implementation Plan

1. Add null byte check: reject if path contains `\0`
2. Use `fs.realpathSync()` to resolve symlinks before `path.relative()` check
3. Handle ENOENT (path doesn't exist yet) by resolving the parent directory
4. Add tests for symlink escape, null byte injection
