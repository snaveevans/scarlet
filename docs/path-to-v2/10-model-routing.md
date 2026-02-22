# Phase 10: Model Routing

## Goal

Different phases have different needs. Route LLM calls to appropriate models based on the phase and task complexity. Strong reasoning models for comprehension and review, fast models for scaffolding and simple tasks.

## Depends On

- Phase 3 (Coding Agent) — the LLM client supports model selection

## What to Build

### 10.1 — Routing Config

**File:** `agentloop/src/llm/routing.ts`

```typescript
interface ModelConfig {
  provider: string;        // "anthropic"
  model: string;           // "claude-sonnet-4-5-20250929"
  maxTokens: number;
  temperature: number;
}

interface ModelRouting {
  default: ModelConfig;
  overrides: {
    phase: string;                              // "explore", "decompose", "scaffold", "code", "review", "reflect"
    complexity?: 'low' | 'medium' | 'high';
    model: ModelConfig;
  }[];
}

function resolveModel(routing: ModelRouting, phase: string, complexity?: string): ModelConfig
```

### 10.2 — Default Routing Table

From brainstorm-v2:

| Phase | Default Model |
|-------|--------------|
| explore | claude-opus-4-6 |
| decompose | claude-opus-4-6 |
| validate-plan | claude-sonnet-4-5-20250929 |
| scaffold | claude-haiku-4-5-20251001 |
| code (low) | claude-haiku-4-5-20251001 |
| code (medium) | claude-sonnet-4-5-20250929 |
| code (high) | claude-opus-4-6 |
| assess | claude-sonnet-4-5-20250929 |
| review | claude-opus-4-6 |
| reflect | claude-opus-4-6 |

### 10.3 — Config Integration

**File:** Update `agentloop/src/types.ts`

Add `modelRouting` to `AgentLoopConfig`:

```typescript
modelRouting?: ModelRouting;
```

**File:** Update `agentloop/src/config.ts`

Load routing config from `.agentloop/config.json` and merge with defaults.

### 10.4 — Wire Into Each Phase

Each phase runner passes the resolved model config to the LLM client. This means updating:
- `comprehension.ts` (explore, decompose, validate)
- `scaffold.ts`
- `executor.ts` (code, assess)
- `self-review.ts`
- `reflection.ts`

The change is small per file — just pass the model config when constructing the LLM request.

## Tests

**File:** `agentloop/tests/llm/routing.test.ts`

- Default routing resolves correct model per phase
- Override for specific phase works
- Override with complexity match works
- Missing phase falls back to default
- Config merge with partial overrides

## Cleanup

- Remove hardcoded model strings from individual phase files once routing is wired.

## Definition of Done

- [ ] Routing config resolves model per phase + complexity
- [ ] Default routing table matches brainstorm-v2
- [ ] Each phase uses resolved model (not hardcoded)
- [ ] Custom routing configurable via `.agentloop/config.json`
- [ ] All tests pass
- [ ] `pnpm build` succeeds
