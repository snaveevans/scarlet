import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveExecutionOrder, hasFailedDependency } from '../planner/dependency-graph.js';
import { runValidationPipeline } from '../validator/validator.js';
import { buildPrompt } from '../utils/context-builder.js';
import { createLLMClient } from '../llm/providers.js';
import {
  stageAndCommit,
  createAndCheckoutBranch,
  sanitizeBranchName,
  getDiffAgainstBase,
} from '../utils/git.js';
import { runScaffold } from '../scaffold/index.js';
import {
  formatReviewForPR,
  reviewFixesToTasks,
  runSelfReview,
} from '../review/index.js';
import { StateManager } from '../state/state-manager.js';
import { ProgressLog } from '../state/progress-log.js';
import type { AgentAdapter } from './agent-adapter.js';
import type { PRD, AgentLoopConfig, Task } from '../types.js';

/** Everything the executor needs to run a full PRD. */
export interface ExecutorOptions {
  prd: PRD;
  /** Absolute path to the PRD file (stored in state for `resume`). */
  prdFile: string;
  config: AgentLoopConfig;
  agent: AgentAdapter;
  stateManager: StateManager;
  progressLog: ProgressLog;
}

/**
 * Core execution loop — processes every task in dependency order.
 *
 * For each task the loop:
 * 1. Checks dependency status and skips if a dependency failed.
 * 2. Builds a context-aware prompt ({@link buildPrompt}).
 * 3. Sends the prompt to the agent adapter.
 * 4. Runs the validation pipeline (typecheck → lint → test → build).
 * 5. On success: marks the task `passed` and optionally commits.
 *    On failure: retries up to `maxAttempts`, injecting the previous error
 *    output into the next prompt so the agent can self-correct.
 *
 * State is persisted to disk after every mutation so that an interrupted
 * run can be resumed with `agentloop resume`.
 */
export async function runLoop(options: ExecutorOptions): Promise<void> {
  const { prd, prdFile, config, agent, stateManager, progressLog } = options;

  const projectRoot = resolve(prd.meta.projectRoot);
  const isNewRun = !stateManager.hasExistingRun();

  // Initialize or resume state
  if (isNewRun) {
    stateManager.initializeRun(prdFile, prd.tasks);
    progressLog.started();
  } else {
    progressLog.info('=== AgentLoop resumed ===');
  }

  // Resolve execution order from the current state tasks
  const state = stateManager.getState();
  const orderedTasks = resolveExecutionOrder(state.tasks);

  // Count dependency chains
  const chainCount = countDependencyChains(orderedTasks);
  progressLog.prdLoaded(orderedTasks.length, chainCount);

  // Set up git branch if auto-commit is enabled
  if (config.autoCommit && !config.dryRun) {
    const branchName =
      config.branch ?? `agentloop/${sanitizeBranchName(prd.projectName)}`;
    try {
      await createAndCheckoutBranch(branchName, { cwd: projectRoot });
      progressLog.info(`Git branch: ${branchName}`);
    } catch (err) {
      progressLog.error(
        `Failed to create branch: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (config.dryRun) {
    printExecutionPlan(orderedTasks);
    return;
  }

  if (isNewRun) {
    const scaffoldResult = await runScaffold({
      tasks: orderedTasks,
      projectRoot,
      meta: prd.meta,
    });

    progressLog.info(
      `[SCAFFOLD] Created ${scaffoldResult.filesCreated.length} files, ${scaffoldResult.testsCreated.length} test files`,
    );

    if (!scaffoldResult.success) {
      const message = scaffoldResult.errors.join('\n\n');
      progressLog.error(`[SCAFFOLD] Failed:\n${message}`);
      throw new Error(`Scaffolding failed:\n${message}`);
    }

    if (config.autoCommit) {
      try {
        const commitMsg = 'chore(scaffold): create project scaffold';
        const sha = await stageAndCommit(commitMsg, { cwd: projectRoot });
        if (sha) {
          progressLog.info(
            `[SCAFFOLD] COMMITTED: ${sha.slice(0, 7)} "${commitMsg}"`,
          );
        }
      } catch (err) {
        progressLog.error(
          `Scaffold commit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async function executeStateTask(taskSnapshot: Task): Promise<void> {
    const currentTask = stateManager.getTask(taskSnapshot.id);
    if (!currentTask) return;

    if (currentTask.status === 'passed' || currentTask.status === 'skipped') {
      return;
    }

    const allTasks = stateManager.getState().tasks;
    if (hasFailedDependency(currentTask, allTasks) && config.skipFailedDeps) {
      stateManager.updateTask(currentTask.id, { status: 'skipped' });
      progressLog.taskSkipped(currentTask.id, 'dependency failed');
      return;
    }

    stateManager.updateTask(currentTask.id, { status: 'in_progress' });
    stateManager.setCurrentTask(currentTask.id);
    progressLog.taskStarted(currentTask.id, currentTask.title);

    const taskStartTime = Date.now();

    for (let attempt = 1; attempt <= currentTask.maxAttempts; attempt++) {
      stateManager.updateTask(currentTask.id, { attempts: attempt });
      const latestTask = stateManager.getTask(currentTask.id)!;
      const isRetry = attempt > 1;
      const recentTasks = getRecentCompleted(stateManager.getState().tasks, 3);

      const prompt = buildPrompt({
        task: latestTask,
        prd,
        recentTasks,
        isRetry,
        contextBudget: config.contextBudget,
        projectRoot,
      });

      const agentResult = await agent.execute({
        prompt,
        projectRoot,
        verbose: config.verbose,
        timeoutMs: config.taskTimeout,
      });

      if (!agentResult.success && !agentResult.stdout) {
        const errorMsg = agentResult.stderr || 'Agent exited with error';
        stateManager.updateTask(latestTask.id, { error: errorMsg });
        progressLog.taskRetry(
          latestTask.id,
          attempt,
          latestTask.maxAttempts,
          errorMsg,
        );

        if (attempt === latestTask.maxAttempts) {
          stateManager.updateTask(latestTask.id, {
            status: 'failed',
            error: errorMsg,
          });
          progressLog.taskFailed(latestTask.id, latestTask.maxAttempts, errorMsg);
        }
        continue;
      }

      const validationResult = await runValidationPipeline(prd.meta, latestTask, {
        steps: config.validationSteps,
        timeoutMs: config.validationTimeout,
        projectRoot,
      });

      progressLog.taskValidation(
        latestTask.id,
        validationResult.results.map((r) => ({
          name: r.step,
          passed: r.passed,
        })),
      );

      if (validationResult.allPassed) {
        const durationMs = Date.now() - taskStartTime;
        stateManager.updateTask(latestTask.id, {
          status: 'passed',
          completedAt: new Date().toISOString(),
        });
        progressLog.taskPassed(
          latestTask.id,
          attempt,
          latestTask.maxAttempts,
          durationMs,
        );

        if (config.autoCommit) {
          try {
            const commitMsg = `feat(${latestTask.id}): ${latestTask.title}`;
            const sha = await stageAndCommit(commitMsg, { cwd: projectRoot });
            if (sha) {
              progressLog.taskCommitted(latestTask.id, sha, commitMsg);
            }
          } catch (err) {
            progressLog.error(
              `Commit failed for ${latestTask.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        stateManager.setCurrentTask(null);
        return;
      }

      const errorSummary = validationResult.errors.join('\n\n');
      const firstFailedStep = validationResult.results.find((r) => !r.passed);
      const retryReason = firstFailedStep
        ? `${firstFailedStep.step} errors`
        : 'validation failed';

      stateManager.updateTask(latestTask.id, { error: errorSummary });
      progressLog.taskRetry(
        latestTask.id,
        attempt,
        latestTask.maxAttempts,
        retryReason,
      );

      if (attempt === latestTask.maxAttempts) {
        stateManager.updateTask(latestTask.id, { status: 'failed' });
        progressLog.taskFailed(
          latestTask.id,
          latestTask.maxAttempts,
          retryReason,
        );
      }
    }

    stateManager.setCurrentTask(null);
  }

  async function executeReviewFixTasks(tasks: Task[]): Promise<void> {
    for (const fixTask of tasks) {
      progressLog.taskStarted(fixTask.id, fixTask.title);
      const taskStartTime = Date.now();
      let taskState: Task = { ...fixTask };
      let passed = false;

      for (let attempt = 1; attempt <= taskState.maxAttempts; attempt++) {
        const isRetry = attempt > 1;
        taskState = { ...taskState, attempts: attempt };
        const recentTasks = getRecentCompleted(stateManager.getState().tasks, 3);

        const prompt = buildPrompt({
          task: taskState,
          prd,
          recentTasks,
          isRetry,
          contextBudget: config.contextBudget,
          projectRoot,
        });

        const agentResult = await agent.execute({
          prompt,
          projectRoot,
          verbose: config.verbose,
          timeoutMs: config.taskTimeout,
        });

        if (!agentResult.success && !agentResult.stdout) {
          const reason = agentResult.stderr || 'Agent exited with error';
          progressLog.taskRetry(taskState.id, attempt, taskState.maxAttempts, reason);
          taskState = { ...taskState, error: reason };
          continue;
        }

        const validationResult = await runValidationPipeline(prd.meta, taskState, {
          steps: config.validationSteps,
          timeoutMs: config.validationTimeout,
          projectRoot,
        });

        progressLog.taskValidation(
          taskState.id,
          validationResult.results.map((r) => ({
            name: r.step,
            passed: r.passed,
          })),
        );

        if (validationResult.allPassed) {
          const durationMs = Date.now() - taskStartTime;
          progressLog.taskPassed(
            taskState.id,
            attempt,
            taskState.maxAttempts,
            durationMs,
          );

          if (config.autoCommit) {
            const commitMsg = `fix(${taskState.id}): ${taskState.title}`;
            try {
              const sha = await stageAndCommit(commitMsg, { cwd: projectRoot });
              if (sha) {
                progressLog.taskCommitted(taskState.id, sha, commitMsg);
              }
            } catch (err) {
              progressLog.error(
                `Commit failed for ${taskState.id}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          passed = true;
          break;
        }

        const firstFailedStep = validationResult.results.find((r) => !r.passed);
        const retryReason = firstFailedStep
          ? `${firstFailedStep.step} errors`
          : 'validation failed';
        progressLog.taskRetry(taskState.id, attempt, taskState.maxAttempts, retryReason);
      }

      if (!passed) {
        throw new Error(`Review fix task ${fixTask.id} failed`);
      }
    }
  }

  // Main execution loop
  for (const taskSnapshot of orderedTasks) {
    await executeStateTask(taskSnapshot);
  }

  if (config.agent === 'scarlet') {
    const llmProvider = config.llm?.provider ?? 'anthropic';
    const reviewModel = config.llm?.model;
    const llmClient = createLLMClient(llmProvider, {
      apiKey: undefined,
      baseUrl: undefined,
    });
    const prdContent = readFileSync(prdFile, 'utf-8');
    const acceptanceCriteria = collectAcceptanceCriteria(prd, prdContent);
    const maxReviewCycles = 2;

    for (let cycle = 1; cycle <= maxReviewCycles; cycle++) {
      const diff = await getDiffAgainstBase({ cwd: projectRoot }, 'main');
      const review = await runSelfReview({
        prdContent,
        acceptanceCriteria,
        diff,
        llmClient,
        model: reviewModel,
      });

      const formatted = formatReviewForPR(review);
      const reviewPath = persistReviewReport(projectRoot, formatted, cycle);
      progressLog.info(
        `[REVIEW] Cycle ${cycle}: approved=${review.approved}, fixes=${review.fixList.length}, report=${reviewPath}`,
      );

      if (review.approved) {
        break;
      }

      if (cycle === maxReviewCycles) {
        progressLog.error(
          `[REVIEW] Not approved after ${maxReviewCycles} cycles; continuing with current result.`,
        );
        break;
      }

      const fixTasks = reviewFixesToTasks(review, cycle);
      if (fixTasks.length === 0) {
        progressLog.error('[REVIEW] Not approved but no fix tasks were produced.');
        break;
      }

      progressLog.info(`[REVIEW] Running ${fixTasks.length} targeted fix tasks.`);
      await executeReviewFixTasks(fixTasks);
    }
  } else {
    progressLog.info('[REVIEW] Skipped (self-review currently runs with scarlet agent only).');
  }

  // Final summary
  const finalState = stateManager.getState();
  const { summary } = finalState;
  progressLog.summary(
    summary.passed,
    summary.failed,
    summary.skipped,
    summary.total,
  );
}

function collectAcceptanceCriteria(prd: PRD, prdContent: string): string[] {
  const criteria = new Set<string>();

  for (const task of prd.tasks) {
    for (const ac of task.acceptanceCriteria) {
      if (ac.trim()) {
        criteria.add(ac.trim());
      }
    }
  }

  const regex = /^[-*]\s*(?:\[[ xX]\]\s*)?(AC-\d+)\s*:\s*(.+)$/gim;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(prdContent)) !== null) {
    if (match[1] && match[2]) {
      criteria.add(`${match[1].toUpperCase()}: ${match[2].trim()}`);
    }
  }

  return Array.from(criteria);
}

function persistReviewReport(
  projectRoot: string,
  markdown: string,
  cycle: number,
): string {
  const stateDir = join(projectRoot, '.agentloop');
  mkdirSync(stateDir, { recursive: true });

  const cyclePath = join(stateDir, `review-cycle-${cycle}.md`);
  writeFileSync(cyclePath, markdown, 'utf-8');

  const latestPath = join(stateDir, 'review.md');
  writeFileSync(latestPath, markdown, 'utf-8');
  return latestPath;
}

/** Return the most recently completed tasks (by `completedAt`), newest first. */
function getRecentCompleted(tasks: Task[], count: number): Task[] {
  return tasks
    .filter((t) => t.status === 'passed' && t.completedAt)
    .sort((a, b) => {
      const aTime = a.completedAt ?? '';
      const bTime = b.completedAt ?? '';
      return bTime.localeCompare(aTime);
    })
    .slice(0, count);
}

/** Count independent dependency chains (tasks with no dependencies are chain roots). */
function countDependencyChains(tasks: Task[]): number {
  return tasks.filter((t) => t.depends.length === 0).length;
}

/** Print a human-readable execution plan to stdout (used by `--dry-run`). */
function printExecutionPlan(tasks: Task[]): void {
  console.log('\n=== Execution Plan (dry run) ===\n');
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const deps =
      task.depends.length > 0 ? ` [depends: ${task.depends.join(', ')}]` : '';
    console.log(`  ${i + 1}. ${task.id}: ${task.title}${deps}`);
  }
  console.log(`\nTotal: ${tasks.length} tasks\n`);
}
