# ADR 003: JSON File for State Persistence

## Status
Accepted

## Context
Scarlet needs to remember which PRDs it has processed, the last commit it saw, and status of each PRD's implementation.

## Decision
Use a single JSON file (default `.scarlet/state.json` inside the target repo). Atomic writes via write-to-temp-then-rename. The `.scarlet/` directory is gitignored in the target repo.

## Consequences
- No database dependency
- Human-readable and debuggable state
- Atomic writes prevent corruption on crash
- Single-instance only (no concurrent access); sufficient for prototype
