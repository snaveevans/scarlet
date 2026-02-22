# Phase 7: Phase 4 — Self-Review

## Goal

After all tasks complete, the agent reviews its own diff against the original PRD. It checks that every AC is satisfied, flags scope creep, and catches common AI code smells.

## Depends On

- Phase 3 (Coding Agent) — uses the LLM client for the review call

## What to Build

### 7.1 — Self-Review Runner

**File:** `agentloop/src/review/self-review.ts`

```typescript
interface SelfReviewOptions {
  prdContent: string;          // original PRD text
  acceptanceCriteria: string[]; // extracted AC list
  diff: string;                 // git diff main..branch
  llmClient: LLMClient;
  model?: string;              // optionally use different model than coder
}

interface ReviewResult {
  approved: boolean;
  acStatus: {
    ac: string;
    satisfied: boolean;
    evidence: string;          // where in the diff this AC is addressed
  }[];
  scopeCreep: string[];        // changes not motivated by PRD
  codeSmells: string[];        // dead code, unused imports, etc.
  fixList: FixItem[];          // things to fix before approval
}

interface FixItem {
  file: string;
  issue: string;
  severity: 'must-fix' | 'should-fix' | 'nit';
}

async function runSelfReview(options: SelfReviewOptions): Promise<ReviewResult>
```

### 7.2 — Review Prompt

**File:** `agentloop/src/review/prompts.ts`

The review prompt:
- You are reviewing a code diff against a PRD
- For each AC, determine if the diff satisfies it (with evidence)
- Flag any changes not motivated by the PRD
- Check for: dead code, unused imports, console.logs, TODO comments, over-abstraction, inconsistent naming, missing error handling

### 7.3 — Fix Cycle

**File:** Update `agentloop/src/executor/executor.ts`

After all tasks complete:
1. Run self-review
2. If `approved` → proceed to PR
3. If not → convert `fixList` to targeted tasks, run through executor again
4. Max 2 review cycles to prevent infinite loops

### 7.4 — Review in PR Description

The review results (AC coverage, decisions, flags) feed into the PR description. This is informational for now — automated PR creation comes later.

**File:** `agentloop/src/review/format-review.ts`

```typescript
function formatReviewForPR(review: ReviewResult): string
```

Outputs markdown suitable for a PR body.

## Tests

**File:** `agentloop/tests/review/self-review.test.ts`

- Mock LLM approves clean diff → `approved: true`
- Mock LLM flags missing AC → `approved: false` with specific AC
- Mock LLM flags scope creep → `scopeCreep` populated
- Fix items have file, issue, severity
- Fix list converts to executable tasks

**File:** `agentloop/tests/review/format-review.test.ts`

- Formats approved review as markdown
- Formats review with issues as markdown
- AC status table renders correctly

## Cleanup

- None. Additive phase.

## Definition of Done

- [ ] Self-review identifies AC satisfaction per criterion
- [ ] Self-review flags scope creep
- [ ] Self-review detects common code smells
- [ ] Fix cycle re-runs executor with targeted tasks
- [ ] Max 2 review cycles enforced
- [ ] Review formatted as markdown for PR
- [ ] All tests pass
- [ ] `pnpm build` succeeds
