import { describe, it, expect } from 'vitest';
import { prdToComprehensionInput } from '../../src/comprehension/prd-bridge.js';
import type { PRD } from '../../src/prd/schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePRD(overrides: Partial<PRD> = {}): PRD {
  return {
    projectName: 'Test Project',
    meta: {
      techStack: 'TypeScript, Node.js',
      testFramework: 'vitest',
      lintCommand: 'pnpm lint',
      buildCommand: 'pnpm build',
      typecheckCommand: 'pnpm typecheck',
      projectRoot: './',
    },
    context: 'This is a Node.js backend project using Express.',
    tasks: [
      {
        id: 'T-001',
        title: 'Add auth',
        depends: [],
        files: ['src/auth.ts'],
        description: 'Implement authentication',
        acceptanceCriteria: [
          'Users can log in with email/password',
          'Invalid credentials return 401',
        ],
        tests: ['tests/auth.test.ts'],
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      },
      {
        id: 'T-002',
        title: 'Add dashboard',
        depends: ['T-001'],
        files: ['src/dashboard.ts'],
        description: 'Create user dashboard',
        acceptanceCriteria: [
          'AC-1: Dashboard shows user data',
          'AC-2: Unauthorized users are redirected',
        ],
        tests: [],
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prdToComprehensionInput', () => {
  it('uses projectName as feature name', () => {
    const input = prdToComprehensionInput(makePRD());
    expect(input.name).toBe('Test Project');
  });

  it('uses context as summary and notes', () => {
    const input = prdToComprehensionInput(makePRD());
    expect(input.summary).toBe(
      'This is a Node.js backend project using Express.',
    );
    expect(input.notes).toBe(
      'This is a Node.js backend project using Express.',
    );
  });

  it('falls back to default summary when context is empty', () => {
    const input = prdToComprehensionInput(makePRD({ context: '' }));
    expect(input.summary).toBe('Implementation of Test Project');
  });

  it('collects all acceptance criteria across tasks', () => {
    const input = prdToComprehensionInput(makePRD());
    expect(input.acceptanceCriteria).toHaveLength(4);
  });

  it('generates AC IDs for criteria without prefix', () => {
    const input = prdToComprehensionInput(makePRD());
    // First two from T-001 have no prefix → get generated IDs
    expect(input.acceptanceCriteria[0]!.id).toBe('AC-001');
    expect(input.acceptanceCriteria[0]!.description).toBe(
      'Users can log in with email/password',
    );
    expect(input.acceptanceCriteria[1]!.id).toBe('AC-002');
  });

  it('parses AC IDs from prefixed criteria', () => {
    const input = prdToComprehensionInput(makePRD());
    // Last two from T-002 have "AC-N:" prefix
    expect(input.acceptanceCriteria[2]!.id).toBe('AC-1');
    expect(input.acceptanceCriteria[2]!.description).toBe(
      'Dashboard shows user data',
    );
    expect(input.acceptanceCriteria[3]!.id).toBe('AC-2');
  });

  it('returns empty constraints and adrs', () => {
    const input = prdToComprehensionInput(makePRD());
    expect(input.constraints).toEqual([]);
    expect(input.adrs).toEqual([]);
  });

  it('handles PRD with no tasks', () => {
    const input = prdToComprehensionInput(makePRD({ tasks: [] }));
    expect(input.acceptanceCriteria).toEqual([]);
  });

  it('handles tasks with empty acceptance criteria', () => {
    const prd = makePRD({
      tasks: [
        {
          id: 'T-001',
          title: 'Setup',
          depends: [],
          files: [],
          description: 'Project setup',
          acceptanceCriteria: [],
          tests: [],
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
        },
      ],
    });
    const input = prdToComprehensionInput(prd);
    expect(input.acceptanceCriteria).toEqual([]);
  });
});
