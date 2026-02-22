import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateManager } from '../../src/state/state-manager.js';
import type { Task } from '../../src/types.js';

function makeTask(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    depends: [],
    files: [],
    description: 'Test task',
    acceptanceCriteria: [],
    tests: [],
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
  };
}

describe('StateManager', () => {
  let tmpDir: string;
  let manager: StateManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentloop-test-'));
    manager = new StateManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports no existing run initially', () => {
    expect(manager.hasExistingRun()).toBe(false);
  });

  it('initializes a run with tasks', () => {
    const tasks = [makeTask('T-001'), makeTask('T-002')];
    manager.initializeRun('/path/to/prd.md', tasks);

    expect(manager.hasExistingRun()).toBe(true);
    const state = manager.getState();
    expect(state.prdFile).toBe('/path/to/prd.md');
    expect(state.tasks).toHaveLength(2);
    expect(state.summary.total).toBe(2);
    expect(state.summary.pending).toBe(2);
  });

  it('updates a task status', () => {
    manager.initializeRun('/prd.md', [makeTask('T-001')]);
    manager.updateTask('T-001', { status: 'passed' });

    const state = manager.getState();
    expect(state.tasks[0]!.status).toBe('passed');
    expect(state.summary.passed).toBe(1);
    expect(state.summary.pending).toBe(0);
  });

  it('persists and reloads state', () => {
    const tasks = [makeTask('T-001'), makeTask('T-002')];
    manager.initializeRun('/prd.md', tasks);
    manager.updateTask('T-001', { status: 'passed' });

    // Create a new manager pointing to the same directory
    const manager2 = new StateManager(tmpDir);
    expect(manager2.hasExistingRun()).toBe(true);
    const state = manager2.getState();
    expect(state.tasks[0]!.status).toBe('passed');
    expect(state.tasks[1]!.status).toBe('pending');
  });

  it('computes summary correctly', () => {
    const tasks = [
      makeTask('T-001'),
      makeTask('T-002'),
      makeTask('T-003'),
      makeTask('T-004'),
    ];
    manager.initializeRun('/prd.md', tasks);
    manager.updateTask('T-001', { status: 'passed' });
    manager.updateTask('T-002', { status: 'failed' });
    manager.updateTask('T-003', { status: 'skipped' });

    const { summary } = manager.getState();
    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.pending).toBe(1);
  });

  it('sets and clears current task', () => {
    manager.initializeRun('/prd.md', [makeTask('T-001')]);
    manager.setCurrentTask('T-001');
    expect(manager.getState().currentTaskId).toBe('T-001');

    manager.setCurrentTask(null);
    expect(manager.getState().currentTaskId).toBeNull();
  });

  it('retrieves task by id', () => {
    manager.initializeRun('/prd.md', [makeTask('T-001'), makeTask('T-002')]);
    const task = manager.getTask('T-002');
    expect(task?.id).toBe('T-002');
  });

  it('returns undefined for unknown task id', () => {
    manager.initializeRun('/prd.md', [makeTask('T-001')]);
    expect(manager.getTask('T-999')).toBeUndefined();
  });

  it('throws when updating unknown task', () => {
    manager.initializeRun('/prd.md', [makeTask('T-001')]);
    expect(() => manager.updateTask('T-999', { status: 'passed' })).toThrow(
      'T-999',
    );
  });
});
