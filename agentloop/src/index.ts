import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePRDFile } from './prd/parser.js';
import { StateManager } from './state/state-manager.js';
import { ProgressLog } from './state/progress-log.js';
import { loadConfig } from './config.js';
import { runLoop } from './executor/executor.js';
import { OpenCodeAdapter } from './executor/opencode-adapter.js';
import { ScarletAdapter } from './executor/scarlet-adapter.js';
import { createLLMClient } from './llm/providers.js';
import { createCoreToolRegistry } from './tools/index.js';
import {
  runComprehension,
  planToTasks,
  savePlan,
  prdToComprehensionInput,
} from './comprehension/index.js';
import type { AgentLoopConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('agentloop')
  .description('Autonomous coding agent orchestrator')
  .version('0.1.0');

// ── run ────────────────────────────────────────────────────────────────────────
program
  .command('run <prd-file>')
  .description('Run the agent loop against a PRD file')
  .option('--max-attempts <n>', 'Max retry attempts per task', parseInt)
  .option('--auto-commit', 'Git commit after each passed task')
  .option('--no-auto-commit', 'Disable auto-commit')
  .option('--branch <name>', 'Git branch to work on')
  .option('--skip-failed-deps', 'Skip tasks whose dependencies failed')
  .option('--no-skip-failed-deps', 'Do not skip tasks with failed deps')
  .option(
    '--validation-steps <steps>',
    'Comma-separated validation pipeline (typecheck,lint,test,build)',
  )
  .option('--agent <name>', 'Coding agent adapter to use', 'opencode')
  .option('--dry-run', 'Parse PRD and show execution plan without running')
  .option('--comprehend', 'Run comprehension phase to generate tasks from AC')
  .option('--context-budget <n>', 'Approx token budget per task', parseInt)
  .option('--verbose', 'Stream agent output to stdout')
  .action(async (prdFile: string, opts: Record<string, unknown>) => {
    const resolvedPrd = resolve(prdFile);
    if (!existsSync(resolvedPrd)) {
      console.error(`Error: PRD file not found: ${resolvedPrd}`);
      process.exit(1);
    }

    let prd;
    try {
      prd = parsePRDFile(resolvedPrd);
    } catch (err) {
      console.error(
        `Error: Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const projectRoot = resolve(prd.meta.projectRoot);
    const cliOverrides = buildCliOverrides(opts);
    const config = loadConfig(projectRoot, cliOverrides);

    // Comprehension phase: generate tasks from AC instead of using PRD's predefined tasks
    if (opts['comprehend'] as boolean) {
      console.log('\n=== Running Comprehension Phase ===\n');
      const llmClient = createLLMClient(config.llm.provider, {
        apiKey: undefined,
        baseUrl: undefined,
      });
      const tools = createCoreToolRegistry();
      const input = prdToComprehensionInput(prd);

      const result = await runComprehension({
        input,
        llmClient,
        tools,
        projectRoot,
      });

      // Persist the plan
      const planPath = savePlan(
        projectRoot,
        prd.projectName,
        result.understanding,
        result.plan,
      );
      console.log(`Plan saved to: ${planPath}`);

      if (result.decisions.length > 0) {
        console.log('\nDecisions made:');
        for (const d of result.decisions) {
          console.log(`  - ${d.decision}: ${d.rationale}`);
        }
      }

      // Replace PRD tasks with comprehension-generated tasks
      const generatedTasks = planToTasks(result.plan, prd.meta);
      console.log(`\nGenerated ${generatedTasks.length} tasks from comprehension.\n`);
      prd = { ...prd, tasks: generatedTasks };
    }

    const stateManager = new StateManager(projectRoot);
    const progressLog = new ProgressLog(projectRoot);
    const agent = resolveAgent(config.agent, config);

    try {
      await runLoop({
        prd,
        prdFile: resolvedPrd,
        config,
        agent,
        stateManager,
        progressLog,
      });
    } catch (err) {
      progressLog.error(err instanceof Error ? err.message : String(err));
      stateManager.persist();
      console.error(
        `\nFatal error: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error('State saved. Run `agentloop resume` to continue.');
      process.exit(1);
    }
  });

// ── comprehend ────────────────────────────────────────────────────────────────
program
  .command('comprehend <prd-file>')
  .description('Run only the comprehension phase (explore + decompose + validate)')
  .option('--verbose', 'Show detailed output')
  .action(async (prdFile: string, opts: Record<string, unknown>) => {
    const resolvedPrd = resolve(prdFile);
    if (!existsSync(resolvedPrd)) {
      console.error(`Error: PRD file not found: ${resolvedPrd}`);
      process.exit(1);
    }

    let prd;
    try {
      prd = parsePRDFile(resolvedPrd);
    } catch (err) {
      console.error(
        `Error: Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const projectRoot = resolve(prd.meta.projectRoot);
    const config = loadConfig(projectRoot, { verbose: opts['verbose'] as boolean ?? false });

    const llmClient = createLLMClient(config.llm.provider, {
      apiKey: undefined,
      baseUrl: undefined,
    });
    const tools = createCoreToolRegistry();
    const input = prdToComprehensionInput(prd);

    console.log(`\n=== Comprehension: ${prd.projectName} ===\n`);
    console.log(`Acceptance Criteria: ${input.acceptanceCriteria.length}`);
    console.log('');

    try {
      const result = await runComprehension({
        input,
        llmClient,
        tools,
        projectRoot,
      });

      // Persist the plan
      const planPath = savePlan(
        projectRoot,
        prd.projectName,
        result.understanding,
        result.plan,
      );

      console.log(`\n=== Comprehension Complete ===\n`);
      console.log(`Tasks generated: ${result.plan.tasks.length}`);
      console.log(`Decisions made: ${result.decisions.length}`);
      console.log(`Plan saved to: ${planPath}`);

      if (result.decisions.length > 0) {
        console.log('\nDecisions:');
        for (const d of result.decisions) {
          console.log(`  - ${d.decision}`);
          console.log(`    Rationale: ${d.rationale}`);
        }
      }

      console.log('\nTasks:');
      for (const task of result.plan.tasks) {
        const deps = task.dependsOn.length > 0
          ? ` [depends: ${task.dependsOn.join(', ')}]`
          : '';
        console.log(`  ${task.id}: ${task.title} (${task.complexity})${deps}`);
      }
      console.log('');
    } catch (err) {
      console.error(
        `\nComprehension failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// ── resume ─────────────────────────────────────────────────────────────────────
program
  .command('resume')
  .description('Resume a previously interrupted run')
  .option('--project-root <path>', 'Project root directory', './')
  .option('--verbose', 'Stream agent output to stdout')
  .action(async (opts: { projectRoot: string; verbose?: boolean }) => {
    const projectRoot = resolve(opts.projectRoot);
    const stateManager = new StateManager(projectRoot);

    if (!stateManager.hasExistingRun()) {
      console.error(
        'No existing run found. Use `agentloop run <prd-file>` to start.',
      );
      process.exit(1);
    }

    const state = stateManager.getState();
    const progressLog = new ProgressLog(projectRoot);

    let prd;
    try {
      prd = parsePRDFile(state.prdFile);
    } catch (err) {
      console.error(
        `Error: Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const config = loadConfig(projectRoot, { verbose: opts.verbose ?? false });
    const agent = resolveAgent(config.agent, config);

    try {
      await runLoop({
        prd,
        prdFile: state.prdFile,
        config,
        agent,
        stateManager,
        progressLog,
      });
    } catch (err) {
      progressLog.error(err instanceof Error ? err.message : String(err));
      stateManager.persist();
      console.error(
        `\nFatal error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// ── status ─────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Check status of current/last run')
  .option('--project-root <path>', 'Project root directory', './')
  .action((opts: { projectRoot: string }) => {
    const projectRoot = resolve(opts.projectRoot);
    const stateManager = new StateManager(projectRoot);

    if (!stateManager.hasExistingRun()) {
      console.log('No run found in this directory.');
      return;
    }

    const state = stateManager.getState();
    const { summary } = state;

    console.log('\n=== AgentLoop Status ===\n');
    console.log(`PRD: ${state.prdFile}`);
    console.log(`Started: ${state.startedAt}`);
    console.log(`Last updated: ${state.lastUpdated}`);
    if (state.currentTaskId) {
      console.log(`Current task: ${state.currentTaskId}`);
    }
    console.log(
      `\nProgress: ${summary.passed}/${summary.total} passed | ${summary.failed} failed | ${summary.skipped} skipped | ${summary.pending} pending\n`,
    );

    // Print task table
    const colW = [8, 40, 12, 8];
    const header = formatRow(
      ['ID', 'Title', 'Status', 'Attempts'],
      colW,
    );
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const task of state.tasks) {
      const statusDisplay = formatStatus(task.status);
      console.log(
        formatRow(
          [task.id, truncate(task.title, colW[1]! - 2), statusDisplay, String(task.attempts)],
          colW,
        ),
      );
    }
    console.log('');
  });

// ── init ───────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Generate a PRD template file')
  .option('--output <path>', 'Output file path', './prd.md')
  .action((opts: { output: string }) => {
    const templateSrc = join(__dirname, '..', 'templates', 'prd-template.md');
    const dest = resolve(opts.output);

    if (!existsSync(templateSrc)) {
      // Write inline template if file not found (e.g., after build)
      writeInlineTemplate(dest);
    } else {
      copyFileSync(templateSrc, dest);
    }
    console.log(`PRD template written to: ${dest}`);
  });

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildCliOverrides(
  opts: Record<string, unknown>,
): Partial<AgentLoopConfig> {
  const overrides: Partial<AgentLoopConfig> = {};
  if (opts['maxAttempts'] !== undefined)
    overrides.maxAttempts = opts['maxAttempts'] as number;
  if (opts['autoCommit'] !== undefined)
    overrides.autoCommit = opts['autoCommit'] as boolean;
  if (opts['branch'] !== undefined)
    overrides.branch = opts['branch'] as string;
  if (opts['skipFailedDeps'] !== undefined)
    overrides.skipFailedDeps = opts['skipFailedDeps'] as boolean;
  if (opts['validationSteps'] !== undefined) {
    overrides.validationSteps = (opts['validationSteps'] as string)
      .split(',')
      .map((s) => s.trim()) as AgentLoopConfig['validationSteps'];
  }
  if (opts['agent'] !== undefined)
    overrides.agent = opts['agent'] as string;
  if (opts['dryRun'] !== undefined)
    overrides.dryRun = opts['dryRun'] as boolean;
  if (opts['contextBudget'] !== undefined)
    overrides.contextBudget = opts['contextBudget'] as number;
  if (opts['verbose'] !== undefined)
    overrides.verbose = opts['verbose'] as boolean;
  return overrides;
}

function resolveAgent(agentName: string, config: AgentLoopConfig) {
  switch (agentName) {
    case 'scarlet': {
      const llmClient = createLLMClient(config.llm.provider, {
        apiKey: undefined,       // read from env
        baseUrl: undefined,
      });
      const tools = createCoreToolRegistry();
      return new ScarletAdapter({
        llmClient,
        tools,
        model: config.llm.model,
        maxTokens: config.llm.maxTokens,
      });
    }
    case 'opencode':
      return new OpenCodeAdapter();
    default:
      console.error(`Unknown agent: ${agentName}. Available: scarlet, opencode`);
      process.exit(1);
  }
}

function formatRow(cells: string[], widths: number[]): string {
  return cells
    .map((cell, i) => cell.padEnd(widths[i] ?? 10))
    .join('  ');
}

function formatStatus(status: string): string {
  switch (status) {
    case 'passed': return 'passed ✓';
    case 'failed': return 'FAILED ✗';
    case 'skipped': return 'skipped';
    case 'in_progress': return 'running…';
    default: return 'pending';
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function writeInlineTemplate(dest: string): void {
  const template = getPRDTemplate();
  writeFileSync(dest, template, 'utf-8');
}

function getPRDTemplate(): string {
  return `# Project: <project-name>

## Meta
- **Tech Stack:** React Router v7, Cloudflare Workers, TypeScript, pnpm
- **Test Framework:** vitest
- **Lint Command:** pnpm lint
- **Build Command:** pnpm build
- **Typecheck Command:** pnpm typecheck
- **Project Root:** ./

## Context
<!-- Freeform architectural context, conventions, patterns.
     This section is injected into EVERY task execution as background context.
     Keep it concise — it eats into the context window. -->

Describe your project's architecture, key patterns, and conventions here.

## Tasks

### Task 1: <title>
- **ID:** T-001
- **Depends:** none
- **Files:** src/components/Example.tsx
- **Description:** What to implement
- **Acceptance Criteria:**
  - Criterion 1
  - Criterion 2
- **Tests:**
  - \`src/components/__tests__/Example.test.tsx\` — renders correctly

### Task 2: <title>
- **ID:** T-002
- **Depends:** T-001
- **Files:** src/api/example.ts
- **Description:** What to implement
- **Acceptance Criteria:**
  - Criterion 1
- **Tests:**
  - \`src/api/__tests__/example.test.ts\` — tests pass
`;
}

program.parse();
