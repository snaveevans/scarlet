import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPRD } from './prd/loader.js';
import { PRDMeta } from './prd/schemas.js';
import type { PRD as LegacyPRD } from './prd/schemas.js';
import type { PRDv2 } from './prd/schemas-v2.js';
import type { LoadedPRD } from './prd/loader.js';
import { StateManager } from './state/state-manager.js';
import { ProgressLog } from './state/progress-log.js';
import { loadConfig } from './config.js';
import { runLoop } from './executor/executor.js';
import { ScarletAdapter } from './executor/scarlet-adapter.js';
import { createLLMClient } from './llm/providers.js';
import { resolveModel } from './llm/routing.js';
import { createCoreToolRegistry } from './tools/index.js';
import {
  runComprehension,
  planToTasks,
  savePlan,
  prdToComprehensionInput,
  prdV2ToComprehensionInput,
} from './comprehension/index.js';
import type { AgentLoopConfig } from './types.js';
import type { ComprehensionInput } from './comprehension/types.js';

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
  .option('--agent <name>', 'Coding agent implementation to use', 'scarlet')
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

    let loaded;
    try {
      loaded = loadPRD(resolvedPrd);
    } catch (err) {
      console.error(
        `Error: Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    let prd = toLegacyPRD(loaded);
    const comprehensionInput = toComprehensionInput(loaded);
    const shouldComprehend =
      loaded.format === 'v2' || Boolean(opts['comprehend']);

    const projectRoot = resolve(prd.meta.projectRoot);
    const cliOverrides = buildCliOverrides(opts);
    const config = loadConfig(projectRoot, cliOverrides);

    // Comprehension phase: generate tasks from AC instead of using PRD's predefined tasks
    if (shouldComprehend) {
      console.log('\n=== Running Comprehension Phase ===\n');
      const exploreRoute = resolveModel(config.modelRouting, 'explore');
      const decomposeRoute = resolveModel(config.modelRouting, 'decompose');
      const comprehensionProvider =
        exploreRoute.provider === decomposeRoute.provider
          ? exploreRoute.provider
          : config.llm.provider;
      if (exploreRoute.provider !== decomposeRoute.provider) {
        console.warn(
          `Comprehension routing provider mismatch (explore=${exploreRoute.provider}, decompose=${decomposeRoute.provider}); using ${comprehensionProvider}.`,
        );
      }

      const llmClient = createLLMClient(comprehensionProvider, {
        apiKey: undefined,
        baseUrl: undefined,
      });
      const tools = createCoreToolRegistry();

      const result = await runComprehension({
        input: comprehensionInput,
        llmClient,
        tools,
        projectRoot,
        exploreModel: exploreRoute.model,
        exploreMaxTokens: exploreRoute.maxTokens,
        exploreTemperature: exploreRoute.temperature,
        decomposeModel: decomposeRoute.model,
        decomposeMaxTokens: decomposeRoute.maxTokens,
        decomposeTemperature: decomposeRoute.temperature,
      });

      // Persist the plan
      const planPath = savePlan(
        projectRoot,
        loaded.name,
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

    let loaded;
    try {
      loaded = loadPRD(resolvedPrd);
    } catch (err) {
      console.error(
        `Error: Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const prd = toLegacyPRD(loaded);
    const input = toComprehensionInput(loaded);
    const projectRoot = resolve(prd.meta.projectRoot);
    const config = loadConfig(projectRoot, { verbose: opts['verbose'] as boolean ?? false });

    const exploreRoute = resolveModel(config.modelRouting, 'explore');
    const decomposeRoute = resolveModel(config.modelRouting, 'decompose');
    const comprehensionProvider =
      exploreRoute.provider === decomposeRoute.provider
        ? exploreRoute.provider
        : config.llm.provider;
    if (exploreRoute.provider !== decomposeRoute.provider) {
      console.warn(
        `Comprehension routing provider mismatch (explore=${exploreRoute.provider}, decompose=${decomposeRoute.provider}); using ${comprehensionProvider}.`,
      );
    }

    const llmClient = createLLMClient(comprehensionProvider, {
      apiKey: undefined,
      baseUrl: undefined,
    });
    const tools = createCoreToolRegistry();

    console.log(`\n=== Comprehension: ${loaded.name} ===\n`);
    console.log(`Acceptance Criteria: ${input.acceptanceCriteria.length}`);
    console.log('');

    try {
      const result = await runComprehension({
        input,
        llmClient,
        tools,
        projectRoot,
        exploreModel: exploreRoute.model,
        exploreMaxTokens: exploreRoute.maxTokens,
        exploreTemperature: exploreRoute.temperature,
        decomposeModel: decomposeRoute.model,
        decomposeMaxTokens: decomposeRoute.maxTokens,
        decomposeTemperature: decomposeRoute.temperature,
      });

      // Persist the plan
      const planPath = savePlan(
        projectRoot,
        loaded.name,
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

    let loaded;
    try {
      loaded = loadPRD(state.prdFile);
    } catch (err) {
      console.error(
        `Error: Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const prd = toLegacyPRD(loaded);
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
  .option('--format <format>', 'PRD template format (v1|v2)', 'v1')
  .option('--output <path>', 'Output file path', './prd.md')
  .action((opts: { output: string; format: string }) => {
    const format = opts.format?.toLowerCase() ?? 'v1';
    if (format !== 'v1' && format !== 'v2') {
      console.error(`Invalid format "${opts.format}". Use "v1" or "v2".`);
      process.exit(1);
    }

    const templateFile =
      format === 'v2' ? 'prd-v2-template.md' : 'prd-template.md';
    const templateSrc = join(__dirname, '..', 'templates', templateFile);
    const dest = resolve(opts.output);

    if (!existsSync(templateSrc)) {
      // Write inline template if file not found (e.g., after build)
      writeInlineTemplate(dest, format);
    } else {
      copyFileSync(templateSrc, dest);
    }
    console.log(`PRD template written to: ${dest}`);
  });

// ── Helpers ────────────────────────────────────────────────────────────────────

function toLegacyPRD(loaded: LoadedPRD): LegacyPRD {
  if (loaded.format === 'v1') {
    return loaded.prd;
  }

  return {
    projectName: loaded.prd.name,
    meta: PRDMeta.parse({ techStack: 'Unknown' }),
    context: buildContextFromV2(loaded.prd),
    tasks: [],
  };
}

function toComprehensionInput(loaded: LoadedPRD): ComprehensionInput {
  if (loaded.format === 'v1') {
    return prdToComprehensionInput(loaded.prd);
  }

  return prdV2ToComprehensionInput(loaded.prd);
}

function buildContextFromV2(prd: PRDv2): string {
  const sections = [prd.summary];

  if (prd.constraints.length > 0) {
    sections.push(
      `Constraints:\n${prd.constraints.map((c) => `- ${c.description}`).join('\n')}`,
    );
  }

  if (prd.adrs.length > 0) {
    sections.push(
      `ADRs:\n${prd.adrs
        .map((adr) => `- ${adr.id}: ${adr.title}\n  Decision: ${adr.decision}\n  Rationale: ${adr.rationale}`)
        .join('\n')}`,
    );
  }

  if (prd.notes) {
    sections.push(`Notes:\n${prd.notes}`);
  }

  return sections.join('\n\n');
}

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
  if (agentName !== 'scarlet') {
    console.error(`Unknown agent: ${agentName}. Available: scarlet`);
    process.exit(1);
  }

  const codeRoute = resolveModel(config.modelRouting, 'code', 'medium');
  const llmClient = createLLMClient(codeRoute.provider, {
    apiKey: undefined,       // read from env
    baseUrl: undefined,
  });
  const tools = createCoreToolRegistry();
  return new ScarletAdapter({
    llmClient,
    tools,
    model: codeRoute.model,
    maxTokens: codeRoute.maxTokens,
    temperature: codeRoute.temperature,
  });
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

function writeInlineTemplate(dest: string, format: 'v1' | 'v2'): void {
  const template = format === 'v2' ? getPRDv2Template() : getPRDv1Template();
  writeFileSync(dest, template, 'utf-8');
}

function getPRDv1Template(): string {
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

function getPRDv2Template(): string {
  return `# PRD: <feature-name>

## Summary
Describe the feature outcome and user value in 1-2 paragraphs.

## Acceptance Criteria
- [ ] AC-1: Describe a concrete, testable behavior
- [ ] AC-2: Describe another testable behavior

## Constraints
- Optional constraint (performance, compatibility, policy, etc.)

## ADRs
### ADR-001: Optional decision title
Decision: Describe the architectural decision.
Rationale: Explain why this decision was made.

## Notes
Optional implementation hints, links, or context.
`;
}

program.parse();
