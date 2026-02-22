import { describe, it, expect } from 'vitest';
import { planToTasks } from '../../src/comprehension/plan-to-tasks.js';
import type { ImplementationPlan } from '../../src/comprehension/types.js';
import type { PRDMeta } from '../../src/prd/schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(): PRDMeta {
  return {
    techStack: 'TypeScript, Node.js',
    testFramework: 'vitest',
    lintCommand: 'pnpm lint',
    buildCommand: 'pnpm build',
    typecheckCommand: 'pnpm typecheck',
    projectRoot: './',
  };
}

function makePlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    tasks: [
      {
        id: 'T-001',
        title: 'Create auth module',
        description: 'Build the authentication module with login/logout',
        satisfiesAC: ['AC-1', 'AC-2'],
        dependsOn: [],
        filesToCreate: ['src/auth.ts', 'src/auth.test.ts'],
        filesToModify: ['src/index.ts'],
        tests: [
          { file: 'src/auth.test.ts', description: 'Login flow works' },
          { file: 'tests/integration/auth.test.ts', description: 'E2E login' },
        ],
        complexity: 'high',
        risks: ['May need session storage'],
      },
      {
        id: 'T-002',
        title: 'Add error handling',
        description: 'Display login errors to users',
        satisfiesAC: ['AC-3'],
        dependsOn: ['T-001'],
        filesToCreate: [],
        filesToModify: ['src/auth.ts', 'src/components/LoginForm.tsx'],
        tests: [
          { file: 'tests/errors.test.ts', description: 'Error messages shown' },
        ],
        complexity: 'low',
        risks: [],
      },
    ],
    acCoverage: [
      { ac: 'AC-1', coveredByTasks: ['T-001'] },
      { ac: 'AC-2', coveredByTasks: ['T-001'] },
      { ac: 'AC-3', coveredByTasks: ['T-002'] },
    ],
    decisions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('planToTasks', () => {
  it('converts planned tasks to executor tasks', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    expect(tasks).toHaveLength(2);
  });

  it('preserves task id and title', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    expect(tasks[0]!.id).toBe('T-001');
    expect(tasks[0]!.title).toBe('Create auth module');
    expect(tasks[1]!.id).toBe('T-002');
  });

  it('maps dependsOn to depends', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    expect(tasks[0]!.depends).toEqual([]);
    expect(tasks[1]!.depends).toEqual(['T-001']);
  });

  it('merges filesToCreate and filesToModify into files', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    // T-001: 2 create + 1 modify = 3 files
    expect(tasks[0]!.files).toEqual([
      'src/auth.ts',
      'src/auth.test.ts',
      'src/index.ts',
    ]);
    // T-002: 0 create + 2 modify = 2 files
    expect(tasks[1]!.files).toEqual([
      'src/auth.ts',
      'src/components/LoginForm.tsx',
    ]);
  });

  it('uses satisfiesAC as acceptanceCriteria', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    expect(tasks[0]!.acceptanceCriteria).toEqual(['AC-1', 'AC-2']);
    expect(tasks[1]!.acceptanceCriteria).toEqual(['AC-3']);
  });

  it('falls back to description when satisfiesAC is empty', () => {
    const plan = makePlan({
      tasks: [
        {
          id: 'T-001',
          title: 'Setup',
          description: 'Initialize the project structure',
          satisfiesAC: [],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
      acCoverage: [],
    });

    const tasks = planToTasks(plan, makeMeta());
    expect(tasks[0]!.acceptanceCriteria).toEqual([
      'Initialize the project structure',
    ]);
  });

  it('extracts test file paths', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    expect(tasks[0]!.tests).toEqual([
      'src/auth.test.ts',
      'tests/integration/auth.test.ts',
    ]);
    expect(tasks[1]!.tests).toEqual(['tests/errors.test.ts']);
  });

  it('sets default status and attempts', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    for (const task of tasks) {
      expect(task.status).toBe('pending');
      expect(task.attempts).toBe(0);
      expect(task.maxAttempts).toBe(3);
    }
  });

  it('preserves description', () => {
    const tasks = planToTasks(makePlan(), makeMeta());
    expect(tasks[0]!.description).toBe(
      'Build the authentication module with login/logout',
    );
  });
});
