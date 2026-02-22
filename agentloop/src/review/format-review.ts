import type { ReviewResult } from './self-review.js';

export function formatReviewForPR(review: ReviewResult): string {
  const lines: string[] = [];

  lines.push('## Self-Review');
  lines.push('');
  lines.push(`**Approved:** ${review.approved ? '✅ Yes' : '❌ No'}`);
  lines.push('');

  lines.push('### Acceptance Criteria Coverage');
  lines.push('');
  lines.push('| Acceptance Criterion | Satisfied | Evidence |');
  lines.push('|---|---|---|');
  for (const ac of review.acStatus) {
    lines.push(
      `| ${escapeCell(ac.ac)} | ${ac.satisfied ? '✅' : '❌'} | ${escapeCell(ac.evidence)} |`,
    );
  }
  if (review.acStatus.length === 0) {
    lines.push('| _(none)_ | - | - |');
  }
  lines.push('');

  lines.push('### Scope Creep');
  if (review.scopeCreep.length === 0) {
    lines.push('- None detected');
  } else {
    for (const item of review.scopeCreep) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');

  lines.push('### Code Smells');
  if (review.codeSmells.length === 0) {
    lines.push('- None detected');
  } else {
    for (const smell of review.codeSmells) {
      lines.push(`- ${smell}`);
    }
  }
  lines.push('');

  lines.push('### Fix List');
  if (review.fixList.length === 0) {
    lines.push('- No fixes required');
  } else {
    for (const fix of review.fixList) {
      lines.push(`- [${fix.severity}] \`${fix.file}\` — ${fix.issue}`);
    }
  }

  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}
