# ADR 002: Agent Abstraction Layer

## Status
Accepted

## Context
Scarlet needs to dispatch work to different coding agents (OpenCode, Claude Code, etc.). Each agent has different CLIs and interaction models.

## Decision
Define a simple adapter interface: `execute({ workingDirectory, instructions, branchName, timeout }) → { success, filesChanged, logs }`. Agent adapters are plain modules in `agents/` loaded by config `agent.type`.

## Consequences
- Adding a new agent = one new file with one exported function
- Mock agent enables full integration testing without real AI
- No dependency injection framework needed; dynamic import by name
