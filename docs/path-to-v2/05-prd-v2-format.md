# Phase 5: PRD v2 Format

## Goal

Introduce the new PRD format from brainstorm-v2: acceptance-criteria-only, no pre-decomposed tasks. The human writes WHAT and WHY. The agent owns HOW and WHERE.

## Depends On

- Phase 4 (Comprehension) — the comprehension system generates tasks from AC, so AC-only PRDs are now viable

## What to Build

### 5.1 — PRD v2 Schema

**File:** `agentloop/src/prd/schemas-v2.ts`

```typescript
const AcceptanceCriterionSchema = z.object({
  id: z.string(),          // "AC-1", "AC-2", etc.
  description: z.string(),
});

const ADRSchema = z.object({
  id: z.string(),          // "ADR-001"
  title: z.string(),
  decision: z.string(),
  rationale: z.string(),
});

const ConstraintSchema = z.object({
  description: z.string(),
});

const PRDv2Schema = z.object({
  name: z.string(),
  summary: z.string(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema),
  constraints: z.array(ConstraintSchema).default([]),
  adrs: z.array(ADRSchema).default([]),
  notes: z.string().optional(),
});

type PRDv2 = z.infer<typeof PRDv2Schema>;
```

### 5.2 — PRD v2 Parser

**File:** `agentloop/src/prd/parser-v2.ts`

Parse the brainstorm-v2 markdown format:

```markdown
# PRD: <feature-name>

## Summary
One paragraph.

## Acceptance Criteria
- [ ] AC-1: Description
- [ ] AC-2: Description

## Constraints
- Constraint text

## ADRs
### ADR-001: Title
Decision text.
Rationale: explanation.

## Notes
Free text.
```

Exports:
```typescript
function parsePRDv2File(filePath: string): PRDv2
function parsePRDv2(content: string): PRDv2
```

### 5.3 — Format Detection

**File:** `agentloop/src/prd/detect-format.ts`

Auto-detect which PRD format a file uses:

```typescript
type PRDFormat = 'v1' | 'v2';

function detectPRDFormat(content: string): PRDFormat
```

Heuristics:
- Has `## Tasks` section → v1
- Has `## Acceptance Criteria` section → v2
- Has `# Project:` header → v1
- Has `# PRD:` header → v2

### 5.4 — Unified Loader

**File:** `agentloop/src/prd/loader.ts`

Single entry point that handles both formats:

```typescript
interface LoadedPRD {
  format: 'v1' | 'v2';
  v1?: PRD;      // set if format is v1
  v2?: PRDv2;    // set if format is v2
  name: string;  // unified name field
}

function loadPRD(filePath: string): LoadedPRD
```

### 5.5 — Wire Into CLI

**File:** Update `agentloop/src/index.ts`

The `run` command:
1. Load PRD (auto-detect format)
2. If v2 → run comprehension → get tasks
3. If v1 → use tasks from PRD directly (existing behavior)
4. Run executor with tasks

### 5.6 — PRD v2 Template

**File:** `agentloop/templates/prd-v2-template.md`

Template for `agentloop init --format v2`.

### 5.7 — Update Init Command

**File:** Update `agentloop/src/index.ts`

Add `--format` flag to `init` command:
- `--format v1` → existing template (default for now)
- `--format v2` → new AC-only template

## Tests

**File:** `agentloop/tests/prd/parser-v2.test.ts`
- Parses well-formed v2 PRD
- Extracts all AC with IDs
- Extracts constraints
- Extracts ADRs with decision + rationale
- Extracts notes
- Handles missing optional sections
- Rejects PRD without summary
- Rejects PRD without AC

**File:** `agentloop/tests/prd/detect-format.test.ts`
- Detects v1 format (has ## Tasks)
- Detects v2 format (has ## Acceptance Criteria)
- Handles ambiguous input gracefully

**File:** `agentloop/tests/prd/loader.test.ts`
- Loads v1 PRD through correct parser
- Loads v2 PRD through correct parser
- Both return unified LoadedPRD

## Cleanup

- Keep v1 parser (`parser.ts`) — both formats supported going forward
- Mark v1 format as "legacy" in help text and template

## Definition of Done

- [ ] v2 PRD parser handles the brainstorm-v2 format
- [ ] Format auto-detection works for both v1 and v2
- [ ] `agentloop init --format v2` produces a valid v2 template
- [ ] v2 PRDs flow through comprehension → executor correctly
- [ ] v1 PRDs still work exactly as before
- [ ] All tests pass
- [ ] `pnpm build` succeeds
