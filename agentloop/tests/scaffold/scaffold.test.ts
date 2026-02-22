import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScaffold } from '../../src/scaffold/scaffold.js';
import type { Task } from '../../src/prd/schemas.js';

vi.mock('../../src/utils/shell.js', () => ({
  runShellCommand: vi.fn(),
}));

import { runShellCommand } from '../../src/utils/shell.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T-001',
    title: 'Create feature',
    depends: [],
    files: ['src/feature.ts'],
    description: 'Create feature files',
    acceptanceCriteria: ['Works'],
    tests: ['tests/feature.test.ts'],
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

describe('runScaffold', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'agentloop-scaffold-'));
    vi.mocked(runShellCommand).mockReset();
    vi.mocked(runShellCommand)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 10,
        timedOut: false,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 10,
        timedOut: false,
      });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates source and test stubs from tasks', async () => {
    const result = await runScaffold({
      tasks: [makeTask()],
      projectRoot,
      meta: {
        techStack: 'TypeScript',
        testFramework: 'vitest',
        lintCommand: 'pnpm lint',
        buildCommand: 'pnpm build',
        typecheckCommand: 'pnpm typecheck',
        projectRoot: './',
      },
    });

    const sourcePath = join(projectRoot, 'src/feature.ts');
    const testPath = join(projectRoot, 'tests/feature.test.ts');

    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(testPath)).toBe(true);
    expect(readFileSync(sourcePath, 'utf-8')).toContain('export {}');
    expect(readFileSync(testPath, 'utf-8')).toContain("it.todo('T-001: Create feature')");
    expect(result.filesCreated).toEqual(['src/feature.ts']);
    expect(result.testsCreated).toEqual(['tests/feature.test.ts']);
    expect(result.success).toBe(true);
  });

  it('skips files that already exist', async () => {
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src/feature.ts'), 'existing', 'utf-8');

    const result = await runScaffold({
      tasks: [makeTask()],
      projectRoot,
      meta: {
        techStack: 'TypeScript',
        testFramework: 'vitest',
        lintCommand: 'pnpm lint',
        buildCommand: 'pnpm build',
        typecheckCommand: 'pnpm typecheck',
        projectRoot: './',
      },
    });

    expect(result.filesCreated).toEqual([]);
    expect(result.testsCreated).toEqual(['tests/feature.test.ts']);
  });

  it('returns errors when validation commands fail', async () => {
    vi.mocked(runShellCommand).mockReset();
    vi.mocked(runShellCommand).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'validation failed',
      durationMs: 10,
      timedOut: false,
    });

    const result = await runScaffold({
      tasks: [makeTask()],
      projectRoot,
      meta: {
        techStack: 'TypeScript',
        testFramework: 'vitest',
        lintCommand: 'pnpm lint',
        buildCommand: 'pnpm build',
        typecheckCommand: 'pnpm typecheck',
        projectRoot: './',
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('Typecheck failed');
  });
});
