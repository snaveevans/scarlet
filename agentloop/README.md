# AgentLoop

AgentLoop is Scarlet's CLI runtime. It executes PRDs through a native LLM-driven agent loop with validation, self-review, and reflection.

## Prerequisites

- Node.js >= 22
- pnpm
- One LLM API key:
  - `ANTHROPIC_API_KEY` (Anthropic Messages API), or
  - `OPENAI_API_KEY` (OpenAI-compatible Chat Completions API)

## Install

```bash
pnpm install
pnpm build
npm link
```

## Commands

```bash
agentloop init --format v2 --output ./prd.md
agentloop run ./prd.md
agentloop comprehend ./prd.md
agentloop status
agentloop resume
```

## Configuration

Create `.agentloop/config.json` in your project root:

```json
{
  "agent": "scarlet",
  "maxAttempts": 3,
  "autoCommit": true,
  "skipFailedDeps": true,
  "validationSteps": ["typecheck", "lint", "test", "build"],
  "contextBudget": 12000,
  "taskTimeout": 600000,
  "validationTimeout": 60000,
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "maxTokens": 8192,
    "temperature": 0
  }
}
```

Optional per-phase model routing is supported through `modelRouting` overrides (see `src/llm/routing.ts`).

## Runtime state

AgentLoop writes runtime artifacts to:

- `.agentloop/state.json` - resumable execution state
- `.agentloop/progress.log` - append-only execution log
- `.scarlet/knowledge/*` and `.scarlet/context.md` - learned project knowledge

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

See the repository root `README.md` and `docs/architecture.md` for full v2 workflow and architecture details.
