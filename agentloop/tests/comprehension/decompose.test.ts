import { describe, it, expect } from 'vitest';
import {
  parseDecomposeOutput,
  buildDecomposePrompt,
} from '../../src/comprehension/decompose.js';
import type {
  CodebaseUnderstanding,
  ComprehensionInput,
} from '../../src/comprehension/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<ComprehensionInput> = {},
): ComprehensionInput {
  return {
    name: 'Auth Feature',
    summary: 'Add user authentication',
    acceptanceCriteria: [
      { id: 'AC-1', description: 'Users can log in' },
      { id: 'AC-2', description: 'Invalid credentials show error' },
    ],
    constraints: [],
    adrs: [],
    notes: '',
    ...overrides,
  };
}

function makeUnderstanding(
  overrides: Partial<CodebaseUnderstanding> = {},
): CodebaseUnderstanding {
  return {
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
    relevantCode: [],
    ...overrides,
  };
}

const VALID_PLAN_JSON = JSON.stringify({
  tasks: [
    {
      id: 'T-001',
      title: 'Setup auth',
      description: 'Create auth module',
      satisfiesAC: ['AC-1'],
      dependsOn: [],
      filesToCreate: ['src/auth.ts'],
      filesToModify: [],
      tests: [{ file: 'tests/auth.test.ts', description: 'auth tests' }],
      complexity: 'medium',
      risks: [],
    },
  ],
  acCoverage: [{ ac: 'AC-1', coveredByTasks: ['T-001'] }],
  decisions: [
    {
      decision: 'Use JWT',
      rationale: 'Stateless auth',
      alternatives: ['Sessions'],
    },
  ],
});

// ---------------------------------------------------------------------------
// parseDecomposeOutput
// ---------------------------------------------------------------------------

describe('parseDecomposeOutput', () => {
  it('parses valid JSON output', () => {
    const result = parseDecomposeOutput(VALID_PLAN_JSON);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.id).toBe('T-001');
    expect(result.acCoverage).toHaveLength(1);
    expect(result.decisions).toHaveLength(1);
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + VALID_PLAN_JSON + '\n```';
    const result = parseDecomposeOutput(wrapped);
    expect(result.tasks).toHaveLength(1);
  });

  it('strips plain code fences', () => {
    const wrapped = '```\n' + VALID_PLAN_JSON + '\n```';
    const result = parseDecomposeOutput(wrapped);
    expect(result.tasks).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDecomposeOutput('not json at all')).toThrow(
      'invalid JSON',
    );
  });

  it('throws on valid JSON that fails schema validation', () => {
    const invalidPlan = JSON.stringify({
      tasks: [],  // min 1 task required
      acCoverage: [],
    });
    expect(() => parseDecomposeOutput(invalidPlan)).toThrow(
      'failed validation',
    );
  });

  it('throws on JSON missing required fields', () => {
    const partial = JSON.stringify({
      tasks: [
        {
          id: 'T-001',
          // missing title, description, satisfiesAC
        },
      ],
      acCoverage: [],
    });
    expect(() => parseDecomposeOutput(partial)).toThrow('failed validation');
  });

  it('handles whitespace around JSON', () => {
    const padded = '\n\n  ' + VALID_PLAN_JSON + '\n\n  ';
    const result = parseDecomposeOutput(padded);
    expect(result.tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildDecomposePrompt
// ---------------------------------------------------------------------------

describe('buildDecomposePrompt', () => {
  it('includes feature name and summary', () => {
    const prompt = buildDecomposePrompt(makeInput(), makeUnderstanding());
    expect(prompt).toContain('Auth Feature');
    expect(prompt).toContain('Add user authentication');
  });

  it('includes acceptance criteria', () => {
    const prompt = buildDecomposePrompt(makeInput(), makeUnderstanding());
    expect(prompt).toContain('AC-1: Users can log in');
    expect(prompt).toContain('AC-2: Invalid credentials show error');
  });

  it('includes project info', () => {
    const prompt = buildDecomposePrompt(makeInput(), makeUnderstanding());
    expect(prompt).toContain('typescript');
    expect(prompt).toContain('express');
    expect(prompt).toContain('pnpm');
    expect(prompt).toContain('vitest');
  });

  it('includes conventions', () => {
    const prompt = buildDecomposePrompt(makeInput(), makeUnderstanding());
    expect(prompt).toContain('feature-based');
    expect(prompt).toContain('co-located');
    expect(prompt).toContain('relative');
  });

  it('includes constraints when present', () => {
    const input = makeInput({
      constraints: ['Must use OAuth2', 'No external auth providers'],
    });
    const prompt = buildDecomposePrompt(input, makeUnderstanding());
    expect(prompt).toContain('Must use OAuth2');
    expect(prompt).toContain('No external auth providers');
  });

  it('omits constraints section when empty', () => {
    const prompt = buildDecomposePrompt(makeInput(), makeUnderstanding());
    expect(prompt).not.toContain('## Constraints');
  });

  it('includes ADRs when present', () => {
    const input = makeInput({
      adrs: [
        {
          id: 'ADR-001',
          title: 'Use JWT',
          decision: 'We will use JWT for auth tokens',
          rationale: 'Stateless, works with microservices',
        },
      ],
    });
    const prompt = buildDecomposePrompt(input, makeUnderstanding());
    expect(prompt).toContain('ADR-001');
    expect(prompt).toContain('Use JWT');
  });

  it('includes notes when present', () => {
    const input = makeInput({ notes: 'Consider rate limiting on login endpoint' });
    const prompt = buildDecomposePrompt(input, makeUnderstanding());
    expect(prompt).toContain('rate limiting');
  });

  it('includes relevant code', () => {
    const understanding = makeUnderstanding({
      relevantCode: [
        {
          path: 'src/middleware/auth.ts',
          purpose: 'Existing auth middleware',
          keyExports: ['requireAuth', 'optionalAuth'],
        },
      ],
    });
    const prompt = buildDecomposePrompt(makeInput(), understanding);
    expect(prompt).toContain('src/middleware/auth.ts');
    expect(prompt).toContain('Existing auth middleware');
    expect(prompt).toContain('requireAuth');
  });
});
