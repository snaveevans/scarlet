/**
 * Bridge between parsed PRD and comprehension input.
 *
 * Converts the existing PRD structure into the ComprehensionInput format
 * expected by the comprehension phase.
 */

import type { PRD } from '../prd/schemas.js';
import type { ComprehensionInput } from './types.js';

/**
 * Convert a parsed PRD into a ComprehensionInput suitable for the
 * comprehension phase.
 *
 * The PRD's per-task acceptance criteria are collected into a flat list.
 * If the PRD already has tasks defined, their AC descriptions are used.
 */
export function prdToComprehensionInput(prd: PRD): ComprehensionInput {
  // Collect all acceptance criteria across tasks
  const acceptanceCriteria: { id: string; description: string }[] = [];
  for (const task of prd.tasks) {
    for (const ac of task.acceptanceCriteria) {
      // If the AC already has an "AC-N:" prefix, parse it out
      const prefixMatch = /^(AC-\d+):\s*(.+)$/.exec(ac);
      if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
        acceptanceCriteria.push({
          id: prefixMatch[1],
          description: prefixMatch[2],
        });
      } else {
        // Generate an ID from the task id + index
        const idx = acceptanceCriteria.length + 1;
        acceptanceCriteria.push({
          id: `AC-${String(idx).padStart(3, '0')}`,
          description: ac,
        });
      }
    }
  }

  return {
    name: prd.projectName,
    summary: prd.context || `Implementation of ${prd.projectName}`,
    acceptanceCriteria,
    constraints: [],
    adrs: [],
    notes: prd.context,
  };
}
