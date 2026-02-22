/**
 * Steps 3+4: Map & Validate — programmatic sanity checks on the plan.
 *
 * Checks for dependency cycles, missing AC coverage, conflicting file
 * modifications, and other structural issues. This is NOT an LLM call —
 * it's deterministic validation.
 */

import type { ImplementationPlan, PlanValidationResult, PlanIssue, ComprehensionInput } from './types.js';

/**
 * Validate an implementation plan for structural issues.
 */
export function validatePlan(
  plan: ImplementationPlan,
  input: ComprehensionInput,
): PlanValidationResult {
  const issues: PlanIssue[] = [];

  checkDependencyCycles(plan, issues);
  checkUnknownDependencies(plan, issues);
  checkACCoverage(plan, input, issues);
  checkConflictingModifications(plan, issues);
  checkEmptyTasks(plan, issues);

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

/**
 * Detect circular dependencies using DFS.
 */
function checkDependencyCycles(
  plan: ImplementationPlan,
  issues: PlanIssue[],
): void {
  const taskIds = new Set(plan.tasks.map((t) => t.id));

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string, path: string[]): boolean {
    if (inStack.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id].join(' → ');
      issues.push({
        severity: 'error',
        message: `Dependency cycle detected: ${cycle}`,
      });
      return true;
    }
    if (visited.has(id)) return false;

    visited.add(id);
    inStack.add(id);

    const task = plan.tasks.find((t) => t.id === id);
    if (task) {
      for (const dep of task.dependsOn) {
        if (taskIds.has(dep)) {
          if (dfs(dep, [...path, id])) return true;
        }
      }
    }

    inStack.delete(id);
    return false;
  }

  for (const task of plan.tasks) {
    dfs(task.id, []);
  }
}

/**
 * Check for dependencies referencing non-existent tasks.
 */
function checkUnknownDependencies(
  plan: ImplementationPlan,
  issues: PlanIssue[],
): void {
  const taskIds = new Set(plan.tasks.map((t) => t.id));

  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep)) {
        issues.push({
          severity: 'error',
          message: `Task ${task.id} depends on unknown task "${dep}"`,
        });
      }
    }
  }
}

/**
 * Verify every AC from the input is covered by at least one task.
 */
function checkACCoverage(
  plan: ImplementationPlan,
  input: ComprehensionInput,
  issues: PlanIssue[],
): void {
  // Check acCoverage entries
  const coveredACs = new Set<string>();
  for (const coverage of plan.acCoverage) {
    coveredACs.add(coverage.ac);

    // Verify the covering tasks exist
    const taskIds = new Set(plan.tasks.map((t) => t.id));
    for (const taskId of coverage.coveredByTasks) {
      if (!taskIds.has(taskId)) {
        issues.push({
          severity: 'warning',
          message: `AC coverage references unknown task "${taskId}" for AC "${coverage.ac}"`,
        });
      }
    }

    if (coverage.coveredByTasks.length === 0) {
      issues.push({
        severity: 'error',
        message: `AC "${coverage.ac}" has empty coveredByTasks — no task addresses it`,
      });
    }
  }

  // Check all input ACs are represented
  for (const ac of input.acceptanceCriteria) {
    const acKey = `${ac.id}: ${ac.description}`;
    const acKeyShort = ac.id;

    // Match by full string, by id prefix, or by description substring
    const found = plan.acCoverage.some(
      (c) =>
        c.ac === acKey ||
        c.ac === acKeyShort ||
        c.ac.startsWith(ac.id) ||
        c.ac.includes(ac.description.slice(0, 30)),
    );

    if (!found) {
      // Also check task.satisfiesAC
      const coveredByTask = plan.tasks.some((t) =>
        t.satisfiesAC.some(
          (s) => s === acKey || s === acKeyShort || s.startsWith(ac.id),
        ),
      );

      if (!coveredByTask) {
        issues.push({
          severity: 'error',
          message: `Acceptance criterion "${ac.id}: ${ac.description}" is not covered by any task`,
        });
      }
    }
  }
}

/**
 * Flag files modified by multiple tasks (potential conflicts).
 */
function checkConflictingModifications(
  plan: ImplementationPlan,
  issues: PlanIssue[],
): void {
  const fileToTasks = new Map<string, string[]>();

  for (const task of plan.tasks) {
    for (const file of task.filesToModify) {
      const existing = fileToTasks.get(file) ?? [];
      existing.push(task.id);
      fileToTasks.set(file, existing);
    }
  }

  for (const [file, tasks] of fileToTasks) {
    if (tasks.length > 1) {
      // Only a warning — not necessarily wrong, but worth noting
      issues.push({
        severity: 'warning',
        message: `File "${file}" is modified by multiple tasks: ${tasks.join(', ')}. Ensure task ordering prevents conflicts.`,
      });
    }
  }
}

/**
 * Flag tasks with empty descriptions.
 */
function checkEmptyTasks(
  plan: ImplementationPlan,
  issues: PlanIssue[],
): void {
  for (const task of plan.tasks) {
    if (!task.description.trim()) {
      issues.push({
        severity: 'error',
        message: `Task ${task.id} ("${task.title}") has an empty description`,
      });
    }
  }
}
