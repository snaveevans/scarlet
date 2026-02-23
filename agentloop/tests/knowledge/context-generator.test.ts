import { describe, it, expect } from 'vitest';
import { generateContext } from '../../src/knowledge/context-generator.js';
import type { CodebaseUnderstanding } from '../../src/comprehension/types.js';
import type { Skill } from '../../src/knowledge/types.js';

describe('generateContext', () => {
  it('includes project structure, conventions, and learned skills', () => {
    const output = generateContext(makeUnderstanding(), [makeSkill()]);

    expect(output).toContain('## Project');
    expect(output).toContain('Language: typescript');
    expect(output).toContain('## Commands');
    expect(output).toContain('test: `pnpm test`');
    expect(output).toContain('## Conventions');
    expect(output).toContain('feature-based');
    expect(output).toContain('## Relevant Code');
    expect(output).toContain('src/tools/index.ts');
    expect(output).toContain('## Learned Skills');
    expect(output).toContain('Scaffold-first pattern');
  });

  it('renders empty-state sections when no commands or skills exist', () => {
    const understanding = makeUnderstanding();
    understanding.project.commands = {};
    understanding.relevantCode = [];

    const output = generateContext(understanding, []);
    expect(output).toContain('- None discovered');
    expect(output).toContain('- None recorded');
    expect(output).toContain('- None yet');
    expect(output).toContain('SCARLET_USER_NOTES_START');
  });
});

function makeUnderstanding(): CodebaseUnderstanding {
  return {
    project: {
      packageManager: 'pnpm',
      framework: 'node',
      language: 'typescript',
      testFramework: 'vitest',
      buildTool: 'tsup',
      commands: {
        typecheck: 'pnpm typecheck',
        test: 'pnpm test',
      },
    },
    conventions: {
      fileOrganization: 'feature-based',
      testOrganization: 'tests/<area>/*.test.ts',
      importStyle: 'ESM with explicit .js extensions',
    },
    relevantCode: [
      {
        path: 'src/tools/index.ts',
        purpose: 'Registers runtime tools',
        keyExports: ['createCoreToolRegistry'],
      },
    ],
  };
}

function makeSkill(): Skill {
  return {
    id: 'skill-001',
    name: 'Scaffold-first pattern',
    description: 'Always scaffold source + tests before implementing behavior.',
    trigger: ['scaffold', 'new module'],
    content: 'Create stubs, run checks, then fill behavior.',
    projectSpecific: true,
    confidence: 0.8,
    usageCount: 4,
    lastUsed: new Date().toISOString(),
    createdFrom: 'phase6',
    tags: ['workflow'],
    references: ['src/scaffold/index.ts'],
  };
}
