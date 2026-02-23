import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  getCurrentBranch: vi.fn().mockResolvedValue('agentloop/test-project'),
  pushBranch: vi.fn().mockResolvedValue(undefined),
  createPullRequest: vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1'),
  sanitizeBranchName: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
  getDiffAgainstBase: vi.fn().mockResolvedValue('diff content'),
}));

vi.mock('../../src/scaffold/index.js', () => ({
  runScaffold: vi.fn().mockResolvedValue({
    filesCreated: [],
    testsCreated: [],
    success: true,
    errors: [],
  }),
}));

vi.mock('../../src/llm/providers.js', () => ({
  createLLMClient: vi.fn().mockReturnValue({
    complete: vi.fn(),
  }),
}));

vi.mock('../../src/review/index.js', () => ({
  runSelfReview: vi.fn().mockResolvedValue({
    approved: true,
    acStatus: [],
    scopeCreep: [],
    codeSmells: [],
    fixList: [],
  }),
  reviewFixesToTasks: vi.fn().mockReturnValue([]),
  formatReviewForPR: vi.fn().mockReturnValue('review markdown'),
}));

vi.mock('../../src/reflection/index.js', () => ({
  runReflection: vi.fn().mockResolvedValue({
    skillsExtracted: [],
    pitfallsExtracted: [],
    toolCandidates: [],
    contextUpdates: [],
    contextPath: '/tmp/.scarlet/context.md',
  }),
}));

import { runValidationPipeline } from '../../src/validator/validator.js';
import { runScaffold } from '../../src/scaffold/index.js';
import { createLLMClient } from '../../src/llm/providers.js';
import {
  runSelfReview,
  reviewFixesToTasks,
  formatReviewForPR,
} from '../../src/review/index.js';
import { runReflection } from '../../src/reflection/index.js';
import {
  createAndCheckoutBranch,
  getCurrentBranch,
  sanitizeBranchName,
} from '../../src/utils/git.js';

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
  agent: 'mock',
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
    vi.mocked(runScaffold).mockResolvedValue({
      filesCreated: [],
      testsCreated: [],
      success: true,
      errors: [],
    });
    vi.mocked(createLLMClient).mockReturnValue({
      complete: vi.fn(),
    });
    vi.mocked(runSelfReview).mockResolvedValue({
      approved: true,
      acStatus: [],
      scopeCreep: [],
      codeSmells: [],
      fixList: [],
    });
    vi.mocked(reviewFixesToTasks).mockReturnValue([]);
    vi.mocked(formatReviewForPR).mockReturnValue('review markdown');
    vi.mocked(runReflection).mockResolvedValue({
      skillsExtracted: [],
      pitfallsExtracted: [],
      toolCandidates: [],
      contextUpdates: [],
      contextPath: join(tmpDir, '.scarlet', 'context.md'),
    });
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
    expect(runScaffold).toHaveBeenCalledTimes(1);
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
    expect(runScaffold).not.toHaveBeenCalled();
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

  it('runs self-review fix cycle for scarlet agent', async () => {
    vi.mocked(runValidationPipeline).mockResolvedValue({
      allPassed: true,
      results: [{ step: 'typecheck', passed: true, output: '', durationMs: 100 }],
      errors: [],
    });
    vi.mocked(runSelfReview)
      .mockResolvedValueOnce({
        approved: false,
        acStatus: [{ ac: 'AC-1', satisfied: false, evidence: 'missing' }],
        scopeCreep: [],
        codeSmells: [],
        fixList: [
          { file: 'src/fix.ts', issue: 'Fix AC-1', severity: 'must-fix' },
        ],
      })
      .mockResolvedValueOnce({
        approved: true,
        acStatus: [{ ac: 'AC-1', satisfied: true, evidence: 'src/fix.ts' }],
        scopeCreep: [],
        codeSmells: [],
        fixList: [],
      });
    vi.mocked(reviewFixesToTasks).mockReturnValue([
      {
        id: 'R1-001',
        title: 'Review fix',
        depends: [],
        files: ['src/fix.ts'],
        description: 'Fix AC-1',
        acceptanceCriteria: ['AC-1'],
        tests: [],
        status: 'pending',
        attempts: 0,
        maxAttempts: 2,
      },
    ]);

    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };
    const scarletConfig: AgentLoopConfig = { ...mockConfig, agent: 'scarlet' };
    const prdFile = join(tmpDir, 'prd.md');
    writeFileSync(prdFile, '# Project: Test Project\n', 'utf-8');

    await runLoop({
      prd,
      prdFile,
      config: scarletConfig,
      agent,
      stateManager,
      progressLog,
    });

    expect(runSelfReview).toHaveBeenCalledTimes(2);
    expect(reviewFixesToTasks).toHaveBeenCalledTimes(1);
    expect(runReflection).toHaveBeenCalledTimes(1);
  });

  it('enforces max two self-review cycles', async () => {
    vi.mocked(runValidationPipeline).mockResolvedValue({
      allPassed: true,
      results: [{ step: 'typecheck', passed: true, output: '', durationMs: 100 }],
      errors: [],
    });
    vi.mocked(runSelfReview).mockResolvedValue({
      approved: false,
      acStatus: [{ ac: 'AC-1', satisfied: false, evidence: 'missing' }],
      scopeCreep: ['extra change'],
      codeSmells: ['todo left'],
      fixList: [{ file: 'src/fix.ts', issue: 'Fix issue', severity: 'must-fix' }],
    });
    vi.mocked(reviewFixesToTasks).mockReturnValue([
      {
        id: 'R1-001',
        title: 'Review fix',
        depends: [],
        files: ['src/fix.ts'],
        description: 'Fix issue',
        acceptanceCriteria: ['Fix issue'],
        tests: [],
        status: 'pending',
        attempts: 0,
        maxAttempts: 1,
      },
    ]);

    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };
    const scarletConfig: AgentLoopConfig = { ...mockConfig, agent: 'scarlet' };
    const prdFile = join(tmpDir, 'prd.md');
    writeFileSync(prdFile, '# Project: Test Project\n', 'utf-8');

    await runLoop({
      prd,
      prdFile,
      config: scarletConfig,
      agent,
      stateManager,
      progressLog,
    });

    expect(runSelfReview).toHaveBeenCalledTimes(2);
    expect(runReflection).not.toHaveBeenCalled();
  });

  it('throws fatal error when branch creation fails', async () => {
    vi.mocked(sanitizeBranchName).mockReturnValue('test-project');
    vi.mocked(createAndCheckoutBranch).mockRejectedValue(
      new Error('fatal: not a git repository'),
    );

    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };
    const autoCommitConfig: AgentLoopConfig = { ...mockConfig, autoCommit: true };

    await expect(
      runLoop({ prd, prdFile: '/prd.md', config: autoCommitConfig, agent, stateManager, progressLog }),
    ).rejects.toThrow('Fatal: failed to create/checkout branch');

    // Agent should never have been called
    expect(agent.execute).not.toHaveBeenCalled();
  });

  it('throws fatal error when post-checkout branch does not match', async () => {
    vi.mocked(sanitizeBranchName).mockReturnValue('test-project');
    vi.mocked(createAndCheckoutBranch).mockResolvedValue(undefined);
    vi.mocked(getCurrentBranch).mockResolvedValue('main');

    const agent = makeMockAgent(true);
    const prd: PRD = { ...mockPRD, meta: { ...mockPRD.meta, projectRoot: tmpDir } };
    const autoCommitConfig: AgentLoopConfig = { ...mockConfig, autoCommit: true };

    await expect(
      runLoop({ prd, prdFile: '/prd.md', config: autoCommitConfig, agent, stateManager, progressLog }),
    ).rejects.toThrow('expected branch');

    expect(agent.execute).not.toHaveBeenCalled();
  });
});
