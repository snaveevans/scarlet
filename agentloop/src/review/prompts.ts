import type { SelfReviewOptions } from './self-review.js';

const MAX_PRD_CHARS = 15000;
const MAX_DIFF_CHARS = 50000;

export const SELF_REVIEW_SYSTEM_PROMPT = `You are reviewing a code diff against a PRD.

Return STRICT JSON only (no markdown, no prose) with this shape:
{
  "approved": boolean,
  "acStatus": [
    {
      "ac": "string",
      "satisfied": boolean,
      "evidence": "string"
    }
  ],
  "scopeCreep": ["string"],
  "codeSmells": ["string"],
  "fixList": [
    {
      "file": "path/to/file",
      "issue": "what to fix",
      "severity": "must-fix|should-fix|nit"
    }
  ]
}

Review requirements:
- For each acceptance criterion, mark satisfied true/false and provide evidence from diff.
- Flag changes not motivated by the PRD as scopeCreep.
- Check for code smells: dead code, unused imports, console logs, TODO comments, over-abstraction, inconsistent naming, missing error handling.
- If anything important is missing/broken, approved must be false and fixList must include actionable items.`;

export function buildSelfReviewPrompt(options: SelfReviewOptions): string {
  const acBlock = options.acceptanceCriteria.length > 0
    ? options.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')
    : '- (none provided)';

  const prd = truncate(options.prdContent, MAX_PRD_CHARS);
  const diff = truncate(options.diff, MAX_DIFF_CHARS);

  return [
    '## Acceptance Criteria',
    acBlock,
    '',
    '## Original PRD',
    prd || '(empty)',
    '',
    '## Diff',
    diff || '(empty)',
    '',
    'Now produce the JSON review result.',
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... [truncated]`;
}
