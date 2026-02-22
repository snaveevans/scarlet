import type { Task } from '../types.js';

/**
 * Resolve execution order of tasks using topological sort (Kahn's algorithm).
 * Throws if circular dependencies are detected.
 * Returns tasks in dependency-first order.
 */
export function resolveExecutionOrder(tasks: Task[]): Task[] {
  const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t]));

  // Validate all dependency IDs exist
  for (const task of tasks) {
    for (const dep of task.depends) {
      if (!taskMap.has(dep)) {
        throw new Error(
          `Task ${task.id} depends on unknown task ${dep}`,
        );
      }
    }
  }

  // Build in-degree map and adjacency list
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> tasks that depend on it

  for (const task of tasks) {
    if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
    if (!dependents.has(task.id)) dependents.set(task.id, []);
    for (const dep of task.depends) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(task.id);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  // Sort initial queue for deterministic output
  queue.sort();

  const result: Task[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const task = taskMap.get(id);
    if (!task) continue;
    result.push(task);

    const deps = dependents.get(id) ?? [];
    for (const depId of deps) {
      const newDegree = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, newDegree);
      if (newDegree === 0) {
        // Insert in sorted position for determinism
        const insertIdx = queue.findIndex((q) => q > depId);
        if (insertIdx === -1) {
          queue.push(depId);
        } else {
          queue.splice(insertIdx, 0, depId);
        }
      }
    }
  }

  if (result.length !== tasks.length) {
    const unresolved = tasks
      .filter((t) => !result.find((r) => r.id === t.id))
      .map((t) => t.id);
    throw new Error(
      `Circular dependency detected among tasks: ${unresolved.join(', ')}`,
    );
  }

  return result;
}

/**
 * Check if a task has any failed or skipped dependency.
 */
export function hasFailedDependency(
  task: Task,
  allTasks: Task[],
): boolean {
  const taskMap = new Map<string, Task>(allTasks.map((t) => [t.id, t]));
  for (const depId of task.depends) {
    const dep = taskMap.get(depId);
    if (dep && (dep.status === 'failed' || dep.status === 'skipped')) {
      return true;
    }
  }
  return false;
}
