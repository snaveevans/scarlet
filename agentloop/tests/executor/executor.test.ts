import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateManager } from '../../src/state/state-manager.js';
import { ProgressLog } from '../../src/state/progress-log.js';
import { runLoop } from '../../src/executor/executor.js';
import type { PRD, AgentLoopConfig } from '../../src/types.js';
import type { AgentAdapter } from '../../src/executor/agent-adapter.js';

// Mock validation pipeline
vi.mock('../../src/validator/validator.js', () => ({
  runValidationPipeline: vi.fn(),
}));

// Mock git utilities
vi.mock('../../src/utils/git.js', () => ({
  createAndCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  stageAndCommit: vi.fn().mockResolvedValue('abc1234'),
  sanitizeBranchName: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
}));

import { runValidationPipeline } from '../../src/validator/validator.js';

const mockPRD: PRD = {
  projectName: 'Test Project',
  meta: {
    techStack: 'TypeScript',
    testFramework: 'vitest',
    lintCommand: 'pnpm lint',
    buildCommand: 'pnpm build',
    typecheckCommand: 'pnpm typecheck',
    projectRoot: './',
  },
  context: 'Test context',
  tasks: [
    {
      id: 'T-001',
      title: 'First task',
      depends: [],
      files: ['src/index.ts'],
      description: 'Do something',
      acceptanceCriteria: ['Works'],
      tests: [],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    },
    {
      id: 'T-002',
      title: 'Second task',
      depends: ['T-001'],
      files: ['src/other.ts'],
      description: 'Do something else',
      acceptanceCriteria: ['Also works'],
      tests: [],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    },
  ],
};

const mockConfig: AgentLoopConfig = {
  agent: 'opencode',
  maxAttempts: 3,
  autoCommit: false,
  skipFailedDeps: true,
  validationSteps: ['typecheck', 'lint'],
  contextBudget: 12000,
  taskTimeout: 600000,
  validationTimeout: 60000,
  dryRun: false,
  verbose: false,
};

function makeMockAgent(successful = true): AgentAdapter {
  return {
    name: 'mock',
    execute: vi.fn().mockResolvedValue({
      success: successful,
      stdout: 'Agent output',
      stderr: '',
      durationMs: 1000,
    }),
  };
}

describe('runLoop', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let progressLog: ProgressLog;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentloop-executor-test-'));
    stateManager = new StateManager(tmpDir);
    progressLog = new ProgressLog(tmpDir);
    vi.resetAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('marks both tasks as passed when validation succeeds', async () => {
    vi.mocked(runValidationPipeline).mockResolvedValue({
      allPassed: true,
      results: [{ step: 'typecheck', passed: true, output: '', durationMs: 100 }],
      errors: [],
    });

    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };

    await runLoop({ prd, prdFile: '/prd.md', config: mockConfig, agent, stateManager, progressLog });

    const state = stateManager.getState();
    expect(state.tasks[0]!.status).toBe('passed');
    expect(state.tasks[1]!.status).toBe('passed');
    expect(state.summary.passed).toBe(2);
  });

  it('marks task as failed after max attempts', async () => {
    vi.mocked(runValidationPipeline).mockResolvedValue({
      allPassed: false,
      results: [{ step: 'typecheck', passed: false, output: 'Type errors', durationMs: 100 }],
      errors: ['Type errors'],
    });

    const agent = makeMockAgent(true);
    const prd: PRD = {
      ...mockPRD,
      meta: { ...mockPRD.meta, projectRoot: tmpDir },
      tasks: [{ ...mockPRD.tasks[0]!, maxAttempts: 2 }],
    };

    await runLoop({ prd, prdFile: '/prd.md', config: mockConfig, agent, stateManager, progressLog });

    const state = stateManager.getState();
    expect(state.tasks[0]!.status).toBe('failed');
    expect(state.tasks[0]!.attempts).toBe(2);
  });

  it('skips task when dependency has failed', async () => {
    vi.mocked(runValidationPipeline).mockResolvedValue({
      allPassed: false,
      results: [{ step: 'typecheck', passed: false, output: 'errors', durationMs: 100 }],
      errors: ['errors'],
    });

    const agent = makeMockAgent(true);
    const prd: PRD = {
      ...mockPRD,
      meta: { ...mockPRD.meta, projectRoot: tmpDir },
      tasks: [
        { ...mockPRD.tasks[0]!, maxAttempts: 1 },
        { ...mockPRD.tasks[1]! },
      ],
    };

    await runLoop({ prd, prdFile: '/prd.md', config: mockConfig, agent, stateManager, progressLog });

    const state = stateManager.getState();
    expect(state.tasks[0]!.status).toBe('failed');
    expect(state.tasks[1]!.status).toBe('skipped');
  });

  it('skips already passed tasks on resume', async () => {
    vi.mocked(runValidationPipeline).mockResolvedValue({
      allPassed: true,
      results: [{ step: 'typecheck', passed: true, output: '', durationMs: 100 }],
      errors: [],
    });

    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };

    // Initialize state with first task already passed
    stateManager.initializeRun('/prd.md', prd.tasks);
    stateManager.updateTask('T-001', { status: 'passed' });

    await runLoop({ prd, prdFile: '/prd.md', config: mockConfig, agent, stateManager, progressLog });

    const state = stateManager.getState();
    expect(state.tasks[0]!.status).toBe('passed');
    expect(state.tasks[1]!.status).toBe('passed');
    // Agent should only be called once (for T-002)
    expect(agent.execute).toHaveBeenCalledTimes(1);
  });

  it('prints dry run plan without executing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };
    const dryRunConfig: AgentLoopConfig = { ...mockConfig, dryRun: true };

    await runLoop({ prd, prdFile: '/prd.md', config: dryRunConfig, agent, stateManager, progressLog });

    expect(agent.execute).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Execution Plan'));
    consoleSpy.mockRestore();
  });
});
