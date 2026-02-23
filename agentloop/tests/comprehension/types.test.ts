import { describe, it, expect } from 'vitest';
import {
  CodebaseUnderstandingSchema,
  ImplementationPlanSchema,
  PlannedTaskSchema,
  DecisionSchema,
  ACCoverageSchema,
  ProjectInfoSchema,
} from '../../src/comprehension/types.js';

// ---------------------------------------------------------------------------
// ProjectInfoSchema
// ---------------------------------------------------------------------------

describe('ProjectInfoSchema', () => {
  it('parses valid project info', () => {
    const data = {
      packageManager: 'pnpm',
      framework: 'react-router',
      language: 'typescript',
      testFramework: 'vitest',
      buildTool: 'vite',
      commands: { typecheck: 'pnpm typecheck', test: 'pnpm test' },
    };
    const result = ProjectInfoSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('allows empty commands', () => {
    const data = {
      packageManager: 'npm',
      framework: 'none',
      language: 'javascript',
      testFramework: 'jest',
      buildTool: 'tsc',
      commands: {},
    };
    const result = ProjectInfoSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = ProjectInfoSchema.safeParse({
      packageManager: 'npm',
      // missing other fields
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlannedTaskSchema
// ---------------------------------------------------------------------------

describe('PlannedTaskSchema', () => {
  it('parses a minimal task', () => {
    const task = {
      id: 'T-001',
      title: 'Setup auth',
      description: 'Implement authentication module',
      satisfiesAC: ['AC-1'],
    };
    const result = PlannedTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependsOn).toEqual([]);
      expect(result.data.filesToCreate).toEqual([]);
      expect(result.data.filesToModify).toEqual([]);
      expect(result.data.tests).toEqual([]);
      expect(result.data.complexity).toBe('medium');
      expect(result.data.risks).toEqual([]);
    }
  });

  it('parses a fully-specified task', () => {
    const task = {
      id: 'T-002',
      title: 'Add login page',
      description: 'Create the login page component',
      satisfiesAC: ['AC-1', 'AC-2'],
      dependsOn: ['T-001'],
      filesToCreate: ['src/pages/Login.tsx'],
      filesToModify: ['src/routes.tsx'],
      tests: [{ file: 'tests/Login.test.tsx', description: 'login renders' }],
      complexity: 'high',
      risks: ['May conflict with existing auth flow'],
    };
    const result = PlannedTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.complexity).toBe('high');
      expect(result.data.risks).toHaveLength(1);
    }
  });

  it('validates complexity enum', () => {
    const task = {
      id: 'T-001',
      title: 'Test',
      description: 'Test',
      satisfiesAC: ['AC-1'],
      complexity: 'extreme',
    };
    const result = PlannedTaskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ImplementationPlanSchema
// ---------------------------------------------------------------------------

describe('ImplementationPlanSchema', () => {
  const validTask = {
    id: 'T-001',
    title: 'Task one',
    description: 'Do the thing',
    satisfiesAC: ['AC-1'],
  };

  it('parses valid plan', () => {
    const plan = {
      tasks: [validTask],
      acCoverage: [{ ac: 'AC-1', coveredByTasks: ['T-001'] }],
      decisions: [
        {
          decision: 'Use JWT',
          rationale: 'Simpler than sessions',
          alternatives: ['Sessions'],
        },
      ],
    };
    const result = ImplementationPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('requires at least one task', () => {
    const plan = {
      tasks: [],
      acCoverage: [],
    };
    const result = ImplementationPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('defaults decisions to empty array', () => {
    const plan = {
      tasks: [validTask],
      acCoverage: [{ ac: 'AC-1', coveredByTasks: ['T-001'] }],
    };
    const result = ImplementationPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisions).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// CodebaseUnderstandingSchema
// ---------------------------------------------------------------------------

describe('CodebaseUnderstandingSchema', () => {
  it('parses valid understanding', () => {
    const data = {
      project: {
        packageManager: 'pnpm',
        framework: 'express',
        language: 'typescript',
        testFramework: 'vitest',
        buildTool: 'tsup',
        commands: { test: 'pnpm test' },
      },
      conventions: {
        fileOrganization: 'feature-based',
        testOrganization: 'co-located',
        importStyle: 'relative',
      },
      relevantCode: [
        {
          path: 'src/auth/login.ts',
          purpose: 'Existing login handler',
          keyExports: ['handleLogin'],
        },
      ],
    };
    const result = CodebaseUnderstandingSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts empty relevantCode array', () => {
    const data = {
      project: {
        packageManager: 'npm',
        framework: 'none',
        language: 'javascript',
        testFramework: 'jest',
        buildTool: 'tsc',
        commands: {},
      },
      conventions: {
        fileOrganization: 'flat',
        testOrganization: '__tests__',
        importStyle: 'barrel exports',
      },
      relevantCode: [],
    };
    const result = CodebaseUnderstandingSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DecisionSchema & ACCoverageSchema
// ---------------------------------------------------------------------------

describe('DecisionSchema', () => {
  it('parses decision with defaults', () => {
    const result = DecisionSchema.safeParse({
      decision: 'Use REST over gRPC',
      rationale: 'Simpler for frontend integration',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alternatives).toEqual([]);
    }
  });
});

describe('ACCoverageSchema', () => {
  it('parses valid coverage', () => {
    const result = ACCoverageSchema.safeParse({
      ac: 'AC-1: Users can log in',
      coveredByTasks: ['T-001', 'T-002'],
    });
    expect(result.success).toBe(true);
  });
});
