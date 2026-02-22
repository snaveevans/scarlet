import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runValidationPipeline } from '../../src/validator/validator.js';
import type { PRDMeta, Task } from '../../src/types.js';

// Mock the shell module
vi.mock('../../src/utils/shell.js', () => ({
  runShellCommand: vi.fn(),
}));

import { runShellCommand } from '../../src/utils/shell.js';

const mockMeta: PRDMeta = {
  techStack: 'TypeScript',
  testFramework: 'vitest',
  lintCommand: 'pnpm lint',
  buildCommand: 'pnpm build',
  typecheckCommand: 'pnpm typecheck',
  projectRoot: './',
};

const mockTask: Task = {
  id: 'T-001',
  title: 'Test task',
  depends: [],
  files: ['src/index.ts'],
  description: 'A test task',
  acceptanceCriteria: ['It works'],
  tests: ['src/__tests__/index.test.ts'],
  status: 'pending',
  attempts: 0,
  maxAttempts: 3,
};

describe('runValidationPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns allPassed true when all steps pass', async () => {
    vi.mocked(runShellCommand).mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 100,
      timedOut: false,
    });

    const result = await runValidationPipeline(mockMeta, mockTask, {
      steps: ['typecheck', 'lint', 'test', 'build'],
      timeoutMs: 5000,
      projectRoot: '/tmp/project',
    });

    expect(result.allPassed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(4);
  });

  it('returns allPassed false when typecheck fails', async () => {
    vi.mocked(runShellCommand).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'Type error in src/index.ts',
      durationMs: 200,
      timedOut: false,
    });

    const result = await runValidationPipeline(mockMeta, mockTask, {
      steps: ['typecheck', 'lint', 'test', 'build'],
      timeoutMs: 5000,
      projectRoot: '/tmp/project',
    });

    expect(result.allPassed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('typecheck');
    // Should only run typecheck (early exit)
    expect(runShellCommand).toHaveBeenCalledTimes(1);
  });

  it('skips test step when task has no tests', async () => {
    vi.mocked(runShellCommand).mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 100,
      timedOut: false,
    });

    const taskNoTests: Task = { ...mockTask, tests: [] };

    const result = await runValidationPipeline(mockMeta, taskNoTests, {
      steps: ['typecheck', 'lint', 'test', 'build'],
      timeoutMs: 5000,
      projectRoot: '/tmp/project',
    });

    expect(result.allPassed).toBe(true);
    // typecheck + lint + build (no test step)
    expect(result.results).toHaveLength(3);
  });

  it('respects steps filter', async () => {
    vi.mocked(runShellCommand).mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 50,
      timedOut: false,
    });

    const result = await runValidationPipeline(mockMeta, mockTask, {
      steps: ['typecheck'],
      timeoutMs: 5000,
      projectRoot: '/tmp/project',
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.step).toBe('typecheck');
  });

  it('marks step as failed on timeout', async () => {
    vi.mocked(runShellCommand).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
      durationMs: 5000,
      timedOut: true,
    });

    const result = await runValidationPipeline(mockMeta, mockTask, {
      steps: ['typecheck'],
      timeoutMs: 5000,
      projectRoot: '/tmp/project',
    });

    expect(result.allPassed).toBe(false);
    expect(result.results[0]!.passed).toBe(false);
    expect(result.results[0]!.output).toContain('Timed out');
  });
});
