# Scarlet v2 Loop Architecture

## Goal

Define a production-safe loop that can take a large PRD and reliably produce a reviewable implementation PR with durable progress, strong verification, and deterministic recovery.

This design is intended to be an evolution of Scarlet v1. It keeps the v1 spirit (single-repo, serial processing, OpenCode-first) while fixing long-horizon execution gaps.

## Summary Decision

Use a **hybrid architecture**:

1. **Spec-sliced planning** (Spec Kit style): decompose one large PRD into explicit stories/tasks.
2. **Fresh-context iterative execution** (Ralph-style): repeated short runs per task, each with strict completion checks.
3. **Durable orchestrator state** (LangGraph-style principles): checkpointed, replay-safe state transitions with idempotency keys.
4. **Strict verification gates**: tests/lint/typecheck and acceptance-criteria checks at task and run levels.

## Why This Architecture

Large PRDs fail when treated as one monolithic prompt. This architecture avoids that by:

- Breaking work into bounded units with explicit acceptance criteria.
- Resetting model context frequently while preserving durable external memory.
- Treating all side effects as checkpointed transitions.
- Making retries safe and deterministic.

## Non-Goals

- Multi-repo orchestration in one Scarlet instance.
- Parallel PRD execution in v2 baseline.
- Fully autonomous merge to main.

## Core Concepts

### 1) PRD Run

A `run` is one end-to-end processing lifecycle for one PRD file path.

### 2) Story Slice

A `story` is a small, testable unit extracted from PRD requirements + acceptance criteria.

### 3) Task Loop

A `task loop` is an iterative execution cycle for one story:

1. plan step
2. execute step
3. verify step
4. critique step
5. continue or mark complete

### 4) Durable Checkpoint

After every state transition that changes external reality, Scarlet writes an atomic checkpoint.

## High-Level Flow

1. Detect new PRD candidate from watched branch commits.
2. Validate PRD JSON and size.
3. Create run record and working branch.
4. Decompose PRD into stories/tasks.
5. For each story (in deterministic order):
   - Run iterative task loop with bounded attempts.
   - Gate on local verification.
   - Commit progress and checkpoint.
6. Run full run-level verification.
7. Create success PR (or draft failure PR).
8. Cleanup workspace and finalize run.

## Component Architecture

### Orchestrator (existing poller evolves)

Responsibilities:

- Own run lifecycle and state transitions.
- Ensure single active run.
- Route events to adapters.

### PRD Compiler (new module)

Responsibilities:

- Convert PRD into normalized internal model.
- Generate story/task graph:
  - deterministic order
  - dependency edges
  - per-task completion criteria

Output artifact:

- `.scarlet/runs/<run-id>/plan.json`

### Loop Engine (new module)

Responsibilities:

- Execute bounded iteration loops per story.
- Re-prompt using latest repo state + prior attempt artifacts.
- Enforce per-task max iterations and time budgets.

Supports pluggable execution modes:

- `single_pass` (one OpenCode run)
- `ralph_fresh` (fresh process each iteration)
- `session_loop` (single long session with stop token)

Default for v2: `ralph_fresh`.

### Verifier (extends existing verification)

Responsibilities:

- Run task-level checks (targeted tests/lint/typecheck).
- Run run-level checks (full command suite).
- Emit structured pass/fail signals with artifacts.

### Git Adapter (existing module hardened)

Responsibilities:

- Deterministic branch/commit operations.
- Idempotent retries for timeout/transient failures.
- Explicit SSH identity handling.

### GitHub Adapter (existing module hardened)

Responsibilities:

- Robust PR creation with retry matrix.
- Deterministic body truncation and redaction.
- Label management and failure reporting.

## State Model (v2)

Persist at `<local_path>/.scarlet/state-v2.json` with atomic writes.

```json
{
  "version": 2,
  "watch": {
    "branch": "main",
    "last_commit": "<sha>"
  },
  "active_run_id": "run_20260212_abc123",
  "queue": [
    {
      "prd_file": "prds/001-example.json",
      "source_head": "<sha>",
      "detected_commit": "<sha>",
      "idempotency_key": "<hash>"
    }
  ],
  "runs": {
    "run_20260212_abc123": {
      "prd_file": "prds/001-example.json",
      "prd_id": "example",
      "branch": "scarlet/example",
      "status": "in_progress",
      "phase": "story_loop",
      "current_story_id": "S2",
      "attempt": 3,
      "max_attempts": 12,
      "timestamps": {
        "created_at": "2026-02-12T18:00:00.000Z",
        "updated_at": "2026-02-12T18:23:41.111Z"
      },
      "stories": [
        {
          "id": "S1",
          "title": "Auth endpoint",
          "status": "done",
          "attempts": 2,
          "verification": "passed"
        },
        {
          "id": "S2",
          "title": "JWT middleware",
          "status": "in_progress",
          "attempts": 1,
          "verification": "pending"
        }
      ],
      "artifacts": {
        "plan": ".scarlet/runs/run_20260212_abc123/plan.json",
        "progress": ".scarlet/runs/run_20260212_abc123/progress.md",
        "logs": ".scarlet/runs/run_20260212_abc123/events.ndjson"
      },
      "interrupt": {
        "reason": null,
        "at_phase": null,
        "resume_token": null
      }
    }
  },
  "prd_index": {
    "prds/001-example.json": {
      "first_detected_commit": "<sha>",
      "last_run_id": "run_20260212_abc123",
      "status": "in_progress"
    }
  }
}
```

## Deterministic Transition Model

Allowed run transitions:

`detected -> validated -> branch_ready -> planned -> story_loop -> run_verify -> pr_created -> cleaned -> completed`

Failure transitions:

`* -> failed` with reason codes:

- `prd_validation_failed`
- `prd_file_too_large`
- `agent_exit_nonzero`
- `agent_timeout`
- `verification_failed`
- `github_pr_failed`
- `git_push_failed`
- `cleanup_failed`

On signal interrupt:

`* -> interrupted`

Resume rule:

- On startup, if any run is `interrupted` or `in_progress`, resume that run before scanning new commits.

## Idempotency and Ordering Rules

1. Queue key: `sha256(prd_file + detected_commit + source_head)`.
2. Do not enqueue if key already exists in queue or terminal run index.
3. Commit range walk must be oldest-first.
4. Tie-breaker within same commit: path lexicographic order.

## Loop Execution Contract

For each story:

1. Build task prompt from:
   - story acceptance criteria
   - constrained file focus
   - latest verifier output
   - prior attempt notes
2. Run agent in fresh context.
3. Run story-level verification command set.
4. If failed:
   - append critique to progress artifact
   - increment attempt
   - retry until `story.max_attempts`
5. If passed:
   - commit with message `scarlet: story <story-id> <title>`
   - mark story done

Stop conditions for run:

- all stories done and run-level verify passed -> success
- max attempts/time budget exceeded -> failure draft PR

## Retry and Backoff Policy

| Operation | Retries | Backoff | Notes |
| --- | --- | --- | --- |
| git fetch/checkout/branch/reset/clean | 1 retry on timeout | fixed 2s | log timeout separately |
| git push | 2 retries on timeout or transient remote errors | 2s, 4s | fail run if exhausted |
| agent run (story loop) | up to story.max_attempts | per-story loop | each attempt fresh process |
| verification | 1 retry only for infra errors | fixed 2s | test failures are not retried automatically |
| PR create 5xx/network | 3 retries | 2s, 4s, 8s | preserve branch for manual PR fallback |
| PR create 422 body-length | 1 retry with stricter truncation | immediate | deterministic truncation |

## Verification Strategy

### Task-level gates

- Fast checks relevant to changed files.
- Must pass before moving to next story.

### Run-level gates

Order:

1. `lint` (if configured)
2. `typecheck` (if configured)
3. PRD/config verification command precedence

If no configured command exists, require at least one successful sanity command (`npm test -- --help` is not acceptable; must execute real checks).

## PR Lifecycle

### Success PR

Include:

1. PRD reference
2. story completion checklist
3. verification evidence
4. commit list
5. artifact summary (plan/progress)

### Failure Draft PR

Include:

1. failure summary and reason code
2. last N agent/verifier logs (redacted)
3. what passed vs failed
4. next recommended manual action
5. optional reasoning artifact

## Security and Isolation

- Keep redaction as final serialization pass for logs and PR bodies.
- Treat tool output as untrusted; sanitize before embedding.
- Use explicit SSH command with deploy key path for git operations.
- Keep execution in repo root only; no writes outside allowlisted paths.

## Implementation Plan for Scarlet Repo

### Phase 1: Durable state and interruption safety

- Add `state-v2` schema and migration loader.
- Track `active_run_id`, run phases, and story progress.
- Implement true interrupt/resume behavior.

### Phase 2: PRD compiler and story slicing

- Add compiler module to generate `plan.json` from PRD.
- Map requirements/ACs to story/task graph.

### Phase 3: Loop engine

- Add per-story iteration loop with bounded attempts.
- Add progress artifact and critique feedback injection.

### Phase 4: Harden adapters

- Git retry matrix and explicit SSH identity.
- GitHub PR failure survivability and deterministic truncation.
- End-to-end redaction on PR body payloads.

### Phase 5: Test and ops hardening

- Add integration tests for:
  - interruption and resume
  - duplicate enqueue prevention
  - oldest-first processing
  - PR creation failure fallback
- Add runbook for manual recovery.

## Success Metrics

- Resume success rate after forced stop >= 99%.
- Duplicate PRD processing rate <= 0.1%.
- PR creation success (automatic) >= 95%.
- Mean time from PRD detection to PR open within configured SLO.

## Recommended Defaults

- `story.max_attempts = 4`
- `run.max_attempts = 20`
- `story.timeout_minutes = 20`
- `run.timeout_minutes = 180`
- `poll_interval_seconds = 30`

## Open Decisions

1. Keep one PR per PRD (default) or allow optional multi-PR fanout by story.
2. Whether to allow optional parallel stories when dependency graph permits.
3. Whether to support alternate worker backends (SWE-agent/OpenHands) in v2 or v3.

## Bottom Line

For Scarlet, the safest path is:

- **Spec-slice first**
- **Iterate in small fresh loops**
- **Checkpoint every meaningful transition**
- **Gate with verification before progression**

That combination gives you high completion rates on large PRDs without sacrificing operability.
