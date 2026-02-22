/**
 * Plan-to-Task conversion — bridges the comprehension output to the
 * existing executor's Task type.
 */

import type { Task, PRDMeta } from '../prd/schemas.js';
import type { ImplementationPlan, PlannedTask } from './types.js';

/**
 * Convert an ImplementationPlan's tasks into the executor's Task format.
 *
 * The executor doesn't need to change — it still receives Task[].
 */
export function planToTasks(
  plan: ImplementationPlan,
  meta: PRDMeta,
): Task[] {
  return plan.tasks.map((pt) => convertTask(pt, meta));
}

function convertTask(planned: PlannedTask, _meta: PRDMeta): Task {
  // Combine create + modify into the files list
  const files = [...planned.filesToCreate, ...planned.filesToModify];

  // Build acceptance criteria from the satisfiesAC references
  const acceptanceCriteria = planned.satisfiesAC.length > 0
    ? planned.satisfiesAC
    : [planned.description];

  // Extract test file paths
  const tests = planned.tests.map((t) => t.file);

  return {
    id: planned.id,
    title: planned.title,
    depends: planned.dependsOn,
    files,
    description: planned.description,
    acceptanceCriteria,
    tests,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
  };
}
