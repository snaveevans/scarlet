# Path to v2: Overview

## What We're Doing

Evolving the existing AgentLoop codebase into the Scarlet Core Engine described in `docs/brainstorm-v2.md`. The existing code is a task executor that runs pre-decomposed PRD tasks through an external agent (OpenCode CLI). The target is an autonomous coding agent that owns decomposition, talks to LLMs directly, and builds knowledge over time.

## Why Evolve (Not Greenfield)

~60% of the existing code is directly reusable:
- **Keep as-is:** dependency graph, validation pipeline, state manager, progress log, git utils, shell utils
- **Extend:** executor loop, config system, type schemas
- **Replace:** PRD parser, OpenCode adapter, context builder
- **Add new:** LLM client, tool runtime, knowledge store, Phase 0/1/4/5

The hard infrastructure problems (atomic state, crash recovery, topo sort, fail-fast validation, safe shell execution) are already solved and tested.

## Phase Breakdown

| Phase | Doc | Summary | Depends On |
|-------|-----|---------|------------|
| 1 | [01-llm-client.md](./01-llm-client.md) | Native LLM client with Anthropic provider | Nothing |
| 2 | [02-tool-runtime.md](./02-tool-runtime.md) | Tool runtime the LLM can call | Phase 1 |
| 3 | [03-coding-agent.md](./03-coding-agent.md) | Agent loop that replaces OpenCode shelling | Phases 1+2 |
| 4 | [04-phase0-comprehension.md](./04-phase0-comprehension.md) | Codebase exploration + task decomposition | Phase 3 |
| 5 | [05-prd-v2-format.md](./05-prd-v2-format.md) | New AC-only PRD format + parser | Phase 4 |
| 6 | [06-phase1-scaffolding.md](./06-phase1-scaffolding.md) | Scaffold-before-implement pattern | Phase 5 |
| 7 | [07-phase4-self-review.md](./07-phase4-self-review.md) | Agent reviews its own diff against PRD | Phase 3 |
| 8 | [08-knowledge-store.md](./08-knowledge-store.md) | Skills, pitfalls, tools persistence | Nothing (can parallel with 1-3) |
| 9 | [09-phase5-reflection.md](./09-phase5-reflection.md) | Post-run knowledge extraction | Phases 7+8 |
| 10 | [10-model-routing.md](./10-model-routing.md) | Per-phase model selection | Phase 3 |
| 11 | [11-memory-manager.md](./11-memory-manager.md) | Layered context management | Phase 3 |
| 12 | [12-cleanup-and-docs.md](./12-cleanup-and-docs.md) | Remove legacy code, final documentation | All phases |

## Dependency Graph

```
Phase 1 (LLM Client)
  └─► Phase 2 (Tool Runtime)
       └─► Phase 3 (Coding Agent)
            ├─► Phase 4 (Phase 0: Comprehension)
            │    └─► Phase 5 (PRD v2 Format)
            │         └─► Phase 6 (Phase 1: Scaffolding)
            ├─► Phase 7 (Phase 4: Self-Review)
            ├─► Phase 10 (Model Routing)
            └─► Phase 11 (Memory Manager)

Phase 8 (Knowledge Store) ◄── independent, start anytime
  └─► Phase 9 (Phase 5: Reflection) ◄── also needs Phase 7

Phase 12 (Cleanup) ◄── after everything else
```

## Parallel Work Opportunities

These can be developed simultaneously:
- **Phases 1-3** (core agent) and **Phase 8** (knowledge store) are independent
- **Phase 7** (self-review) and **Phase 4** (comprehension) are independent once Phase 3 is done
- **Phase 10** (model routing) and **Phase 11** (memory manager) are independent

## Guiding Principles

1. **Every phase produces a working system.** No phase leaves the codebase broken.
2. **Tests first.** Each phase includes test requirements that must pass before it's complete.
3. **Clean up as you go.** Each phase specifies what to remove, not just what to add.
4. **Existing tests must keep passing** unless the module they test is explicitly being replaced.
5. **No speculative code.** Only build what the current phase needs.
