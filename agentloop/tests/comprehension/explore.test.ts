import { describe, it, expect } from 'vitest';
import { parseExploreOutput } from '../../src/comprehension/explore.js';

// ---------------------------------------------------------------------------
// parseExploreOutput
// ---------------------------------------------------------------------------

const VALID_UNDERSTANDING = JSON.stringify({
  project: {
    packageManager: 'pnpm',
    framework: 'react-router',
    language: 'typescript',
    testFramework: 'vitest',
    buildTool: 'vite',
    commands: {
      typecheck: 'pnpm typecheck',
      lint: 'pnpm lint',
      test: 'pnpm test',
      build: 'pnpm build',
    },
  },
  conventions: {
    fileOrganization: 'feature-based with barrel exports',
    testOrganization: 'co-located __tests__ directories',
    importStyle: 'path aliases (~/) with barrel re-exports',
  },
  relevantCode: [
    {
      path: 'src/auth/login.ts',
      purpose: 'Existing login handler',
      keyExports: ['handleLogin', 'LoginRequest'],
    },
  ],
});

describe('parseExploreOutput', () => {
  it('parses valid JSON output', () => {
    const result = parseExploreOutput(VALID_UNDERSTANDING);
    expect(result.project.packageManager).toBe('pnpm');
    expect(result.project.framework).toBe('react-router');
    expect(result.conventions.fileOrganization).toContain('feature-based');
    expect(result.relevantCode).toHaveLength(1);
    expect(result.relevantCode[0]!.path).toBe('src/auth/login.ts');
  });

  it('strips markdown json fences', () => {
    const wrapped = '```json\n' + VALID_UNDERSTANDING + '\n```';
    const result = parseExploreOutput(wrapped);
    expect(result.project.language).toBe('typescript');
  });

  it('strips plain code fences', () => {
    const wrapped = '```\n' + VALID_UNDERSTANDING + '\n```';
    const result = parseExploreOutput(wrapped);
    expect(result.project.language).toBe('typescript');
  });

  it('handles leading/trailing whitespace', () => {
    const padded = '  \n\n' + VALID_UNDERSTANDING + '\n  \n';
    const result = parseExploreOutput(padded);
    expect(result.project.packageManager).toBe('pnpm');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseExploreOutput('this is not json')).toThrow(
      'invalid JSON',
    );
  });

  it('throws on valid JSON failing schema', () => {
    const incomplete = JSON.stringify({
      project: {
        packageManager: 'npm',
        // missing required fields
      },
    });
    expect(() => parseExploreOutput(incomplete)).toThrow('failed validation');
  });

  it('accepts empty relevantCode', () => {
    const data = JSON.stringify({
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
        testOrganization: 'tests/',
        importStyle: 'relative',
      },
      relevantCode: [],
    });
    const result = parseExploreOutput(data);
    expect(result.relevantCode).toEqual([]);
  });

  it('accepts optional commands', () => {
    const data = JSON.stringify({
      project: {
        packageManager: 'npm',
        framework: 'none',
        language: 'javascript',
        testFramework: 'jest',
        buildTool: 'tsc',
        commands: { test: 'npm test' },
      },
      conventions: {
        fileOrganization: 'flat',
        testOrganization: 'tests/',
        importStyle: 'relative',
      },
      relevantCode: [],
    });
    const result = parseExploreOutput(data);
    expect(result.project.commands.test).toBe('npm test');
    expect(result.project.commands.lint).toBeUndefined();
  });
});
