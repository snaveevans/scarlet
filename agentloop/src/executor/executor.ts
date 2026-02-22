import { resolveExecutionOrder, hasFailedDependency } from '../planner/dependency-graph.js';
import { runValidationPipeline } from '../validator/validator.js';
import { buildPrompt } from '../utils/context-builder.js';
import { stageAndCommit, createAndCheckoutBranch, sanitizeBranchName } from '../utils/git.js';
import { StateManager } from '../state/state-manager.js';
import { ProgressLog } from '../state/progress-log.js';
import type { AgentAdapter } from './agent-adapter.js';
import type { PRD, AgentLoopConfig, Task } from '../types.js';

export interface ExecutorOptions {
  prd: PRD;
  prdFile: string;
  config: AgentLoopConfig;
  agent: AgentAdapter;
  stateManager: StateManager;
  progressLog: ProgressLog;
}

export async function runLoop(options: ExecutorOptions): Promise<void> {
  const { prd, prdFile, config, agent, stateManager, progressLog } = options;

  const projectRoot = prd.meta.projectRoot;

  // Initialize or resume state
  if (!stateManager.hasExistingRun()) {
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

  // Main execution loop
  for (const taskSnapshot of orderedTasks) {
    // Always read latest state
    const currentTask = stateManager.getTask(taskSnapshot.id);
    if (!currentTask) continue;

    // Skip already completed tasks
    if (currentTask.status === 'passed' || currentTask.status === 'skipped') {
      continue;
    }

    // Check dependency failures
    const allTasks = stateManager.getState().tasks;
    if (hasFailedDependency(currentTask, allTasks) && config.skipFailedDeps) {
      stateManager.updateTask(currentTask.id, { status: 'skipped' });
      progressLog.taskSkipped(currentTask.id, 'dependency failed');
      continue;
    }

    // Mark in progress
    stateManager.updateTask(currentTask.id, { status: 'in_progress' });
    stateManager.setCurrentTask(currentTask.id);
    progressLog.taskStarted(currentTask.id, currentTask.title);

    const taskStartTime = Date.now();
    let passed = false;

    for (let attempt = 1; attempt <= currentTask.maxAttempts; attempt++) {
      stateManager.updateTask(currentTask.id, { attempts: attempt });

      // Get the latest task state (may have error from previous attempt)
      const latestTask = stateManager.getTask(currentTask.id)!;
      const isRetry = attempt > 1;

      // Get recent completed tasks for context
      const recentTasks = getRecentCompleted(stateManager.getState().tasks, 3);

      // Build prompt
      const prompt = buildPrompt({
        task: latestTask,
        prd,
        recentTasks,
        isRetry,
        contextBudget: config.contextBudget,
        projectRoot,
      });

      // Execute agent
      const agentResult = await agent.execute({
        prompt,
        projectRoot,
        verbose: config.verbose,
        timeoutMs: config.taskTimeout,
      });

      if (!agentResult.success && !agentResult.stdout) {
        // Agent crashed without producing output
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

      // Run validation
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

        // Auto-commit
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

        passed = true;
        break;
      } else {
        const errorSummary = validationResult.errors.join('\n\n');
        const firstFailedStep = validationResult.results.find(
          (r) => !r.passed,
        );
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
    }

    stateManager.setCurrentTask(null);
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

function countDependencyChains(tasks: Task[]): number {
  // Count tasks with no dependencies (roots of chains)
  return tasks.filter((t) => t.depends.length === 0).length;
}

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
