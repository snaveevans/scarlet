import { describe, it, expect } from 'vitest';
import { formatReviewForPR } from '../../src/review/format-review.js';

describe('formatReviewForPR', () => {
  it('formats approved review markdown', () => {
    const markdown = formatReviewForPR({
      approved: true,
      acStatus: [{ ac: 'AC-1: Works', satisfied: true, evidence: 'src/a.ts' }],
      scopeCreep: [],
      codeSmells: [],
      fixList: [],
    });

    expect(markdown).toContain('## Self-Review');
    expect(markdown).toContain('**Approved:** ✅ Yes');
    expect(markdown).toContain('| Acceptance Criterion | Satisfied | Evidence |');
    expect(markdown).toContain('AC-1: Works');
  });

  it('formats review with issues and fix list', () => {
    const markdown = formatReviewForPR({
      approved: false,
      acStatus: [{ ac: 'AC-2: Missing', satisfied: false, evidence: 'No diff evidence' }],
      scopeCreep: ['Unrequested route added'],
      codeSmells: ['Console log left in production code'],
      fixList: [
        {
          file: 'src/routes/debug.ts',
          issue: 'Remove debug route',
          severity: 'must-fix',
        },
      ],
    });

    expect(markdown).toContain('**Approved:** ❌ No');
    expect(markdown).toContain('Unrequested route added');
    expect(markdown).toContain('Console log left in production code');
    expect(markdown).toContain('[must-fix]');
    expect(markdown).toContain('`src/routes/debug.ts`');
  });
});
