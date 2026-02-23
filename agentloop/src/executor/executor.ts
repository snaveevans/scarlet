import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveExecutionOrder, hasFailedDependency } from '../planner/dependency-graph.js';
import { runValidationPipeline } from '../validator/validator.js';
import { resolveModel, type TaskComplexity } from '../llm/routing.js';
import { createLLMClient } from '../llm/providers.js';
import { LayeredMemoryManager, messagesToPrompt } from '../memory/index.js';
import {
  createPullRequest,
  stageAndCommit,
  createAndCheckoutBranch,
  getCurrentBranch,
  pushBranch,
  sanitizeBranchName,
  getDiffAgainstBase,
} from '../utils/git.js';
import { FileKnowledgeStore } from '../knowledge/file-store.js';
import { runScaffold } from '../scaffold/index.js';
import { runReflection } from '../reflection/index.js';
import {
  formatReviewForPR,
  reviewFixesToTasks,
  runSelfReview,
} from '../review/index.js';
import { StateManager } from '../state/state-manager.js';
import { ProgressLog } from '../state/progress-log.js';
import type { AgentAdapter } from './agent-adapter.js';
import type { PRD, AgentLoopConfig, Task } from '../types.js';
import type { ReflectionResult } from '../reflection/index.js';
import type { ImplementationPlan } from '../comprehension/types.js';

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

const EXECUTION_SYSTEM_CONTEXT = [
  'You are implementing a task in an existing codebase.',
  'Implement only what is required for the current task.',
  'Do not broaden scope or perform unrelated refactors.',
].join('\n');

const TASK_EXECUTION_USER_PROMPT = [
  'Implement the current task using the provided layered context.',
  'Meet all acceptance criteria and update tests as required.',
  'Return a concise summary of what changed.',
].join('\n');

/**
 * Core execution loop — processes every task in dependency order.
 *
 * For each task the loop:
 * 1. Checks dependency status and skips if a dependency failed.
 * 2. Builds layered context through the memory manager.
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

  const contextPath = join(projectRoot, '.scarlet', 'context.md');
  const contextMd = existsSync(contextPath)
    ? readFileSync(contextPath, 'utf-8')
    : '';
  const memoryManager = new LayeredMemoryManager({
    maxTokens: config.contextBudget,
    projectRoot,
    contextMd,
  });
  memoryManager.setSystemContext(EXECUTION_SYSTEM_CONTEXT);
  memoryManager.setProjectContext(buildProjectContext(prd, contextMd));
  hydrateSessionMemory(memoryManager, state.tasks);
  const promptKnowledgeStore = new FileKnowledgeStore(projectRoot);

  // Set up git branch if auto-commit is enabled
  if (config.autoCommit && !config.dryRun) {
    const branchName =
      config.branch ?? `agentloop/${sanitizeBranchName(prd.projectName)}`;
    try {
      await createAndCheckoutBranch(branchName, { cwd: projectRoot });
    } catch (err) {
      throw new Error(
        `Fatal: failed to create/checkout branch "${branchName}": ${err instanceof Error ? err.message : String(err)}. ` +
        `Refusing to continue — commits would land on the wrong branch.`,
      );
    }

    // Verify we're actually on the expected branch
    const currentBranch = await getCurrentBranch({ cwd: projectRoot });
    if (currentBranch !== branchName) {
      throw new Error(
        `Fatal: expected branch "${branchName}" but currently on "${currentBranch}". ` +
        `Refusing to continue — commits would land on the wrong branch.`,
      );
    }
    progressLog.info(`Git branch: ${branchName}`);
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

    if (!scaffoldResult.success) {
      const message = scaffoldResult.errors.join('\n\n');
      progressLog.error(`[SCAFFOLD] Failed:\n${message}`);
      throw new Error(`Scaffolding failed:\n${message}`);
    }

    progressLog.info(
      `[SCAFFOLD] Created ${scaffoldResult.filesCreated.length} files, ${scaffoldResult.testsCreated.length} test files`,
    );

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

  // ── Shared single-task execution engine ───────────────────────────────────
  interface TaskExecutionContext {
    task: Task;
    /** Prefix for commit messages (e.g. 'feat' or 'fix'). */
    commitPrefix: string;
    /** Phase label for the prompt builder ('code' or 'review-fix'). */
    phase: string;
  }

  interface TaskExecutionResult {
    passed: boolean;
    attempts: number;
  }

  /**
   * Run a single task through the attempt → agent → validate → commit loop.
   * Shared by both executeStateTask and executeReviewFixTasks.
   */
  async function runSingleTask(ctx: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task, commitPrefix, phase } = ctx;
    const taskStartTime = Date.now();

    for (let attempt = 1; attempt <= task.maxAttempts; attempt++) {
      const latestTask = { ...task, attempts: attempt, error: attempt > 1 ? task.error : task.error };
      const isRetry = attempt > 1;
      const recentTasks = getRecentCompleted(stateManager.getState().tasks, 3);

      const prompt = buildTaskPrompt({
        memoryManager,
        task: latestTask,
        prd,
        recentTasks,
        isRetry,
        projectRoot,
        knowledgeStore: promptKnowledgeStore,
        phase,
      });
      const codeModel = resolveModel(
        config.modelRouting,
        'code',
        inferTaskComplexity(latestTask),
      );

      const agentResult = await agent.execute({
        prompt,
        projectRoot,
        verbose: config.verbose,
        timeoutMs: config.taskTimeout,
        model: codeModel.model,
        maxTokens: codeModel.maxTokens,
        temperature: codeModel.temperature,
      });

      if (!agentResult.success && !agentResult.stdout) {
        const errorMsg = agentResult.stderr || 'Agent exited with error';
        task.error = errorMsg;
        progressLog.taskRetry(
          task.id,
          attempt,
          task.maxAttempts,
          errorMsg,
        );
        if (attempt === task.maxAttempts) {
          return { passed: false, attempts: attempt };
        }
        continue;
      }

      const validationResult = await runValidationPipeline(prd.meta, latestTask, {
        steps: config.validationSteps,
        timeoutMs: config.validationTimeout,
        projectRoot,
      });

      progressLog.taskValidation(
        task.id,
        validationResult.results.map((r) => ({
          name: r.step,
          passed: r.passed,
        })),
      );

      if (validationResult.allPassed) {
        const durationMs = Date.now() - taskStartTime;
        progressLog.taskPassed(
          task.id,
          attempt,
          task.maxAttempts,
          durationMs,
        );

        if (config.autoCommit) {
          try {
            const commitMsg = `${commitPrefix}(${task.id}): ${task.title}`;
            const sha = await stageAndCommit(commitMsg, { cwd: projectRoot });
            if (sha) {
              progressLog.taskCommitted(task.id, sha, commitMsg);
            }
          } catch (err) {
            progressLog.error(
              `Commit failed for ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        memoryManager.addCompletedTask(task.id, task.title, 'passed');
        for (const file of task.files) {
          memoryManager.addModifiedFile(file);
        }
        return { passed: true, attempts: attempt };
      }

      const errorSummary = validationResult.errors.join('\n\n');
      const firstFailedStep = validationResult.results.find((r) => !r.passed);
      const retryReason = firstFailedStep
        ? `${firstFailedStep.step} errors`
        : 'validation failed';

      task.error = errorSummary;
      progressLog.taskRetry(
        task.id,
        attempt,
        task.maxAttempts,
        retryReason,
      );

      if (attempt === task.maxAttempts) {
        return { passed: false, attempts: attempt };
      }
    }

    return { passed: false, attempts: task.maxAttempts };
  }

  // ── Task executors ──────────────────────────────────────────────────────

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
      memoryManager.addCompletedTask(currentTask.id, currentTask.title, 'skipped');
      return;
    }

    stateManager.updateTask(currentTask.id, { status: 'in_progress' });
    stateManager.setCurrentTask(currentTask.id);
    progressLog.taskStarted(currentTask.id, currentTask.title);

    const result = await runSingleTask({
      task: currentTask,
      commitPrefix: 'feat',
      phase: 'code',
    });

    if (result.passed) {
      stateManager.updateTask(currentTask.id, {
        status: 'passed',
        attempts: result.attempts,
        completedAt: new Date().toISOString(),
      });
    } else {
      stateManager.updateTask(currentTask.id, {
        status: 'failed',
        attempts: result.attempts,
        error: currentTask.error,
      });
      progressLog.taskFailed(currentTask.id, result.attempts, currentTask.error ?? 'unknown');
      memoryManager.addCompletedTask(currentTask.id, currentTask.title, 'failed');
    }

    stateManager.setCurrentTask(null);
  }

  async function executeReviewFixTasks(tasks: Task[]): Promise<void> {
    for (const fixTask of tasks) {
      progressLog.taskStarted(fixTask.id, fixTask.title);

      const result = await runSingleTask({
        task: fixTask,
        commitPrefix: 'fix',
        phase: 'review-fix',
      });

      if (!result.passed) {
        memoryManager.addCompletedTask(fixTask.id, fixTask.title, 'failed');
        throw new Error(`Review fix task ${fixTask.id} failed`);
      }
    }
  }

  // Main execution loop
  for (const taskSnapshot of orderedTasks) {
    await executeStateTask(taskSnapshot);
  }

  if (config.agent === 'scarlet') {
    const reviewRoute = resolveModel(config.modelRouting, 'review');
    const reflectionRoute = resolveModel(config.modelRouting, 'reflect');
    const reviewClient = createLLMClient(reviewRoute.provider, {
      apiKey: undefined,
      baseUrl: undefined,
    });
    const prdContent = readFileSync(prdFile, 'utf-8');
    const acceptanceCriteria = collectAcceptanceCriteria(prd, prdContent);
    const maxReviewCycles = 2;
    let reviewApproved = false;

    for (let cycle = 1; cycle <= maxReviewCycles; cycle++) {
      const diff = await getDiffAgainstBase({ cwd: projectRoot }, config.baseBranch);
      const review = await runSelfReview({
        prdContent,
        acceptanceCriteria,
        diff,
        llmClient: reviewClient,
        model: reviewRoute.model,
        maxTokens: reviewRoute.maxTokens,
        temperature: reviewRoute.temperature,
      });

      const formatted = formatReviewForPR(review);
      const reviewPath = persistReviewReport(projectRoot, formatted, cycle);
      progressLog.info(
        `[REVIEW] Cycle ${cycle}: approved=${review.approved}, fixes=${review.fixList.length}, report=${reviewPath}`,
      );

      if (review.approved) {
        reviewApproved = true;
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

    if (reviewApproved) {
      const reflectionDiff = await getDiffAgainstBase({ cwd: projectRoot }, config.baseBranch);
      const progressLogPath = join(projectRoot, '.agentloop', 'progress.log');
      const progressLogContent = existsSync(progressLogPath)
        ? readFileSync(progressLogPath, 'utf-8')
        : '';
      const reflectionPlan = buildReflectionPlan(stateManager.getState().tasks);
      const knowledgeStore = new FileKnowledgeStore(projectRoot);
      const reflectionClient =
        reflectionRoute.provider === reviewRoute.provider
          ? reviewClient
          : createLLMClient(reflectionRoute.provider, {
              apiKey: undefined,
              baseUrl: undefined,
            });

      const reflection = await runReflection({
        prdName: prd.projectName,
        projectRoot,
        tasks: stateManager.getState().tasks,
        plan: reflectionPlan,
        diff: reflectionDiff,
        progressLog: progressLogContent,
        llmClient: reflectionClient,
        knowledgeStore,
        model: reflectionRoute.model,
        maxTokens: reflectionRoute.maxTokens,
        temperature: reflectionRoute.temperature,
      });

      progressLog.info(
        `[REFLECTION] skills=${reflection.skillsExtracted.length}, pitfalls=${reflection.pitfallsExtracted.length}, tools=${reflection.toolCandidates.length}, context=${reflection.contextPath}`,
      );

      if (config.autoCommit) {
        try {
          const commitMsg = 'chore(reflection): persist learned knowledge';
          const sha = await stageAndCommit(commitMsg, { cwd: projectRoot });
          if (sha) {
            progressLog.info(`[REFLECTION] COMMITTED: ${sha.slice(0, 7)} "${commitMsg}"`);
          }
        } catch (err) {
          progressLog.error(
            `[REFLECTION] Commit failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        try {
          const branch = await getCurrentBranch({ cwd: projectRoot });
          await pushBranch(branch, { cwd: projectRoot });
          const prBody = buildPullRequestBody(prd, reflection);
          const prUrl = await createPullRequest(
            `feat: ${prd.projectName}`,
            prBody,
            { cwd: projectRoot },
          );
          progressLog.info(`[PR] Created: ${prUrl || '(no URL returned)'}`);
        } catch (err) {
          progressLog.error(
            `[PR] Push or PR creation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      progressLog.info('[REFLECTION] Skipped because self-review was not approved.');
    }
  } else {
    progressLog.info('[REVIEW] Skipped (self-review currently runs with scarlet agent only).');
    progressLog.info('[REFLECTION] Skipped (reflection currently runs with scarlet agent only).');
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

interface BuildTaskPromptOptions {
  memoryManager: LayeredMemoryManager;
  task: Task;
  prd: PRD;
  recentTasks: Task[];
  isRetry: boolean;
  projectRoot: string;
  knowledgeStore: FileKnowledgeStore;
  phase: string;
}

function buildTaskPrompt(options: BuildTaskPromptOptions): string {
  const {
    memoryManager,
    task,
    prd,
    recentTasks,
    isRetry,
    projectRoot,
    knowledgeStore,
    phase,
  } = options;

  memoryManager.clearTaskScope();
  memoryManager.setPhaseContext(phase, `${task.id}: ${task.title}`);
  memoryManager.setTaskPlan(formatTaskPlan(task, prd, recentTasks));
  memoryManager.setFileContents(loadTaskFiles(task.files, projectRoot));

  const knowledgeQuery = [task.title, task.description, ...task.acceptanceCriteria].join(' ');
  memoryManager.setMatchedKnowledge(
    knowledgeStore.querySkills(knowledgeQuery, 4),
    knowledgeStore.queryPitfalls(knowledgeQuery, 4),
  );

  if (isRetry && task.error) {
    memoryManager.setPreviousError(task.error);
  }

  const messages = memoryManager.buildMessages(TASK_EXECUTION_USER_PROMPT);
  return messagesToPrompt(messages);
}

function buildProjectContext(prd: PRD, contextMd: string): string {
  const sections = [
    `Project: ${prd.projectName}`,
    `Tech stack: ${prd.meta.techStack}`,
    '',
    'PRD Context:',
    prd.context || '(none)',
  ];

  if (contextMd.trim()) {
    sections.push('', 'Knowledge Context (.scarlet/context.md):', contextMd.trim());
  }

  return sections.join('\n');
}

function hydrateSessionMemory(memoryManager: LayeredMemoryManager, tasks: Task[]): void {
  for (const task of tasks) {
    if (task.status === 'pending' || task.status === 'in_progress') {
      continue;
    }
    memoryManager.addCompletedTask(task.id, task.title, task.status);
    if (task.status === 'passed') {
      for (const file of task.files) {
        memoryManager.addModifiedFile(file);
      }
    }
    if (task.error) {
      memoryManager.addDecision(`${task.id}: ${task.error}`);
    }
  }
}

function loadTaskFiles(
  filePaths: string[],
  projectRoot: string,
): { path: string; content: string }[] {
  const loaded: { path: string; content: string }[] = [];
  for (const filePath of filePaths) {
    const fullPath = join(projectRoot, filePath);
    if (!existsSync(fullPath)) continue;
    try {
      loaded.push({
        path: filePath,
        content: readFileSync(fullPath, 'utf-8'),
      });
    } catch {
      // Skip unreadable files.
    }
  }
  return loaded;
}

function formatTaskPlan(task: Task, prd: PRD, recentTasks: Task[]): string {
  const lines: string[] = [];
  lines.push(`Task: ${task.id} — ${task.title}`);
  lines.push(task.description);
  lines.push('');
  lines.push(`Project context: ${prd.context || '(none)'}`);
  lines.push(`Tech stack: ${prd.meta.techStack}`);

  if (task.files.length > 0) {
    lines.push('', 'Files:', ...task.files.map((file) => `- ${file}`));
  }

  if (task.acceptanceCriteria.length > 0) {
    lines.push(
      '',
      'Acceptance Criteria:',
      ...task.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }

  if (task.tests.length > 0) {
    lines.push('', 'Tests:', ...task.tests.map((test) => `- ${test}`));
  }

  if (recentTasks.length > 0) {
    lines.push(
      '',
      'Recently Completed:',
      ...recentTasks.map((recent) => `- ${recent.id}: ${recent.title}`),
    );
  }

  return lines.join('\n');
}

function buildPullRequestBody(prd: PRD, reflection: ReflectionResult): string {
  const lines: string[] = [];
  lines.push(`## ${prd.projectName}`);
  lines.push('');
  lines.push('Automated PR generated by AgentLoop.');
  lines.push('');
  lines.push('### Reflection Summary');
  lines.push(`- Skills extracted: ${reflection.skillsExtracted.length}`);
  lines.push(`- Pitfalls extracted: ${reflection.pitfallsExtracted.length}`);
  lines.push(`- Tool candidates: ${reflection.toolCandidates.length}`);
  lines.push(`- Context file: \`${reflection.contextPath}\``);

  if (reflection.toolCandidates.length > 0) {
    lines.push('');
    lines.push('### Tool Candidates');
    for (const candidate of reflection.toolCandidates) {
      lines.push(`- ${candidate}`);
    }
  }

  return lines.join('\n');
}

function buildReflectionPlan(tasks: Task[]): ImplementationPlan {
  const acToTasks = new Map<string, string[]>();
  const plannedTasks: ImplementationPlan['tasks'] = tasks.map((task) => {
    for (const ac of task.acceptanceCriteria) {
      const key = ac.trim();
      if (!key) continue;
      const coveredBy = acToTasks.get(key) ?? [];
      coveredBy.push(task.id);
      acToTasks.set(key, coveredBy);
    }

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      satisfiesAC: task.acceptanceCriteria,
      dependsOn: task.depends,
      filesToCreate: [],
      filesToModify: task.files,
      tests: task.tests.map((file) => ({
        file,
        description: `Validation coverage for ${task.id}`,
      })),
      complexity: 'medium',
      risks: task.error ? [task.error] : [],
    };
  });

  return {
    tasks: plannedTasks,
    acCoverage: Array.from(acToTasks.entries()).map(([ac, coveredByTasks]) => ({
      ac,
      coveredByTasks,
    })),
    decisions: [],
  };
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

function inferTaskComplexity(task: Task): TaskComplexity {
  const fileCount = task.files.length;
  const dependencyCount = task.depends.length;
  const descriptionLength = task.description.trim().length;

  if (fileCount >= 4 || dependencyCount >= 3 || descriptionLength >= 700) {
    return 'high';
  }

  if (fileCount <= 1 && dependencyCount === 0 && descriptionLength <= 240) {
    return 'low';
  }

  return 'medium';
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
