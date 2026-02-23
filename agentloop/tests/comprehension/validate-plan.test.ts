import { describe, it, expect } from 'vitest';
import { validatePlan } from '../../src/comprehension/validate-plan.js';
import type { ImplementationPlan, ComprehensionInput } from '../../src/comprehension/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ComprehensionInput> = {}): ComprehensionInput {
  return {
    name: 'Test Feature',
    summary: 'A test feature',
    acceptanceCriteria: [
      { id: 'AC-1', description: 'Users can log in' },
      { id: 'AC-2', description: 'Login errors shown' },
    ],
    constraints: [],
    adrs: [],
    notes: '',
    ...overrides,
  };
}

function makePlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    tasks: [
      {
        id: 'T-001',
        title: 'Auth module',
        description: 'Implement the auth module',
        satisfiesAC: ['AC-1'],
        dependsOn: [],
        filesToCreate: ['src/auth.ts'],
        filesToModify: [],
        tests: [{ file: 'tests/auth.test.ts', description: 'auth works' }],
        complexity: 'medium',
        risks: [],
      },
      {
        id: 'T-002',
        title: 'Error display',
        description: 'Show login errors',
        satisfiesAC: ['AC-2'],
        dependsOn: ['T-001'],
        filesToCreate: [],
        filesToModify: ['src/auth.ts'],
        tests: [],
        complexity: 'low',
        risks: [],
      },
    ],
    acCoverage: [
      { ac: 'AC-1', coveredByTasks: ['T-001'] },
      { ac: 'AC-2', coveredByTasks: ['T-002'] },
    ],
    decisions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validatePlan', () => {
  it('returns valid for a correct plan', () => {
    const result = validatePlan(makePlan(), makeInput());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects dependency cycles', () => {
    const plan = makePlan({
      tasks: [
        {
          id: 'T-001',
          title: 'Task A',
          description: 'A',
          satisfiesAC: ['AC-1'],
          dependsOn: ['T-002'],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
        {
          id: 'T-002',
          title: 'Task B',
          description: 'B',
          satisfiesAC: ['AC-2'],
          dependsOn: ['T-001'],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
    });

    const result = validatePlan(plan, makeInput());
    expect(result.valid).toBe(false);
    const cycleIssues = result.issues.filter((i) =>
      i.message.includes('cycle'),
    );
    expect(cycleIssues.length).toBeGreaterThan(0);
    expect(cycleIssues[0]!.severity).toBe('error');
  });

  it('detects unknown dependencies', () => {
    const plan = makePlan({
      tasks: [
        {
          id: 'T-001',
          title: 'Task A',
          description: 'A',
          satisfiesAC: ['AC-1', 'AC-2'],
          dependsOn: ['T-999'],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        { ac: 'AC-2', coveredByTasks: ['T-001'] },
      ],
    });

    const result = validatePlan(plan, makeInput());
    expect(result.valid).toBe(false);
    const unknownDeps = result.issues.filter((i) =>
      i.message.includes('unknown task'),
    );
    expect(unknownDeps).toHaveLength(1);
  });

  it('detects uncovered acceptance criteria', () => {
    const plan = makePlan({
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        // AC-2 is missing from coverage
      ],
      tasks: [
        {
          id: 'T-001',
          title: 'Auth',
          description: 'Auth module',
          satisfiesAC: ['AC-1'],  // only covers AC-1
          dependsOn: [],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
    });

    const result = validatePlan(plan, makeInput());
    expect(result.valid).toBe(false);
    const uncovered = result.issues.filter((i) =>
      i.message.includes('not covered'),
    );
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]!.message).toContain('AC-2');
  });

  it('warns about conflicting file modifications', () => {
    const plan = makePlan({
      tasks: [
        {
          id: 'T-001',
          title: 'Task A',
          description: 'Modifies shared file',
          satisfiesAC: ['AC-1'],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: ['src/shared.ts'],
          tests: [],
          complexity: 'low',
          risks: [],
        },
        {
          id: 'T-002',
          title: 'Task B',
          description: 'Also modifies shared file',
          satisfiesAC: ['AC-2'],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: ['src/shared.ts'],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
    });

    const result = validatePlan(plan, makeInput());
    // Conflicting modifications are warnings, not errors
    expect(result.valid).toBe(true);
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.message).toContain('shared.ts');
  });

  it('detects empty task descriptions', () => {
    const plan = makePlan({
      tasks: [
        {
          id: 'T-001',
          title: 'Empty task',
          description: '',
          satisfiesAC: ['AC-1', 'AC-2'],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        { ac: 'AC-2', coveredByTasks: ['T-001'] },
      ],
    });

    const result = validatePlan(plan, makeInput());
    expect(result.valid).toBe(false);
    const emptyDesc = result.issues.filter((i) =>
      i.message.includes('empty description'),
    );
    expect(emptyDesc).toHaveLength(1);
  });

  it('detects empty coveredByTasks in acCoverage', () => {
    const plan = makePlan({
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        { ac: 'AC-2', coveredByTasks: [] },
      ],
    });

    const result = validatePlan(plan, makeInput());
    expect(result.valid).toBe(false);
    const emptyAC = result.issues.filter((i) =>
      i.message.includes('empty coveredByTasks'),
    );
    expect(emptyAC).toHaveLength(1);
  });

  it('warns about acCoverage referencing unknown task', () => {
    const plan = makePlan({
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        { ac: 'AC-2', coveredByTasks: ['T-999'] },
      ],
    });

    const result = validatePlan(plan, makeInput());
    // Unknown task in coverage is a warning
    const warnings = result.issues.filter(
      (i) => i.severity === 'warning' && i.message.includes('T-999'),
    );
    expect(warnings).toHaveLength(1);
  });

  it('accepts AC coverage via task satisfiesAC when acCoverage is missing', () => {
    const plan = makePlan({
      acCoverage: [],  // no explicit coverage entries
      tasks: [
        {
          id: 'T-001',
          title: 'All-in-one',
          description: 'Does everything',
          satisfiesAC: ['AC-1', 'AC-2'],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
    });

    const result = validatePlan(plan, makeInput());
    expect(result.valid).toBe(true);
  });
});
