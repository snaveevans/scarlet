import { describe, it, expect } from 'vitest';
import {
  resolveExecutionOrder,
  hasFailedDependency,
} from '../../src/planner/dependency-graph.js';
import type { Task } from '../../src/types.js';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    depends: overrides.depends ?? [],
    files: overrides.files ?? [],
    description: overrides.description ?? '',
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    tests: overrides.tests ?? [],
    status: overrides.status ?? 'pending',
    attempts: overrides.attempts ?? 0,
    maxAttempts: overrides.maxAttempts ?? 3,
    error: overrides.error,
    completedAt: overrides.completedAt,
  };
}

describe('resolveExecutionOrder', () => {
  it('returns single task unchanged', () => {
    const tasks = [makeTask({ id: 'T-001' })];
    const result = resolveExecutionOrder(tasks);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('T-001');
  });

  it('orders tasks with simple chain A→B→C', () => {
    const tasks = [
      makeTask({ id: 'T-003', depends: ['T-002'] }),
      makeTask({ id: 'T-001' }),
      makeTask({ id: 'T-002', depends: ['T-001'] }),
    ];
    const result = resolveExecutionOrder(tasks);
    const ids = result.map((t) => t.id);
    expect(ids.indexOf('T-001')).toBeLessThan(ids.indexOf('T-002'));
    expect(ids.indexOf('T-002')).toBeLessThan(ids.indexOf('T-003'));
  });

  it('handles parallel tasks (no dependencies between them)', () => {
    const tasks = [
      makeTask({ id: 'T-002', depends: ['T-001'] }),
      makeTask({ id: 'T-003', depends: ['T-001'] }),
      makeTask({ id: 'T-001' }),
    ];
    const result = resolveExecutionOrder(tasks);
    const ids = result.map((t) => t.id);
    expect(ids[0]).toBe('T-001');
    expect(ids).toContain('T-002');
    expect(ids).toContain('T-003');
    expect(result).toHaveLength(3);
  });

  it('throws on circular dependency', () => {
    const tasks = [
      makeTask({ id: 'T-001', depends: ['T-002'] }),
      makeTask({ id: 'T-002', depends: ['T-001'] }),
    ];
    expect(() => resolveExecutionOrder(tasks)).toThrow('Circular dependency');
  });

  it('throws on unknown dependency', () => {
    const tasks = [makeTask({ id: 'T-001', depends: ['T-999'] })];
    expect(() => resolveExecutionOrder(tasks)).toThrow('unknown task');
  });

  it('handles empty task list', () => {
    expect(resolveExecutionOrder([])).toEqual([]);
  });

  it('handles diamond dependency (A→B, A→C, B→D, C→D)', () => {
    const tasks = [
      makeTask({ id: 'T-D', depends: ['T-B', 'T-C'] }),
      makeTask({ id: 'T-B', depends: ['T-A'] }),
      makeTask({ id: 'T-C', depends: ['T-A'] }),
      makeTask({ id: 'T-A' }),
    ];
    const result = resolveExecutionOrder(tasks);
    const ids = result.map((t) => t.id);
    expect(ids[0]).toBe('T-A');
    expect(ids[ids.length - 1]).toBe('T-D');
    expect(result).toHaveLength(4);
  });
});

describe('hasFailedDependency', () => {
  it('returns false when no dependencies', () => {
    const task = makeTask({ id: 'T-001' });
    expect(hasFailedDependency(task, [task])).toBe(false);
  });

  it('returns true when dependency is failed', () => {
    const dep = makeTask({ id: 'T-001', status: 'failed' });
    const task = makeTask({ id: 'T-002', depends: ['T-001'] });
    expect(hasFailedDependency(task, [dep, task])).toBe(true);
  });

  it('returns true when dependency is skipped', () => {
    const dep = makeTask({ id: 'T-001', status: 'skipped' });
    const task = makeTask({ id: 'T-002', depends: ['T-001'] });
    expect(hasFailedDependency(task, [dep, task])).toBe(true);
  });

  it('returns false when dependency is passed', () => {
    const dep = makeTask({ id: 'T-001', status: 'passed' });
    const task = makeTask({ id: 'T-002', depends: ['T-001'] });
    expect(hasFailedDependency(task, [dep, task])).toBe(false);
  });

  it('returns false when dependency is pending', () => {
    const dep = makeTask({ id: 'T-001', status: 'pending' });
    const task = makeTask({ id: 'T-002', depends: ['T-001'] });
    expect(hasFailedDependency(task, [dep, task])).toBe(false);
  });
});
