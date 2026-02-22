import { z } from 'zod';

/** Lifecycle status of a task within the execution loop. */
export const TaskStatus = z.enum([
  'pending',
  'in_progress',
  'passed',
  'failed',
  'skipped',
]);

export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * A single unit of work parsed from the PRD.
 *
 * Tasks are executed in dependency order. On each attempt the agent receives
 * a prompt built from this data, and the result is validated against the
 * configured pipeline. After {@link maxAttempts} consecutive failures the
 * task is marked `failed`.
 */
export const Task = z.object({
  /** Unique identifier (e.g. "T-001"). Referenced in `depends` arrays. */
  id: z.string(),
  /** Short human-readable title shown in logs and status output. */
  title: z.string(),
  /** IDs of tasks that must pass before this task can start. */
  depends: z.array(z.string()).default([]),
  /** Relative paths the agent is expected to create or modify. */
  files: z.array(z.string()).default([]),
  /** Detailed implementation instructions sent to the agent. */
  description: z.string(),
  /** Conditions that must be true for the task to be considered done. */
  acceptanceCriteria: z.array(z.string()),
  /** Test file paths run during the `test` validation step. */
  tests: z.array(z.string()).default([]),
  /** Current lifecycle status. Updated by the executor during a run. */
  status: TaskStatus.default('pending'),
  /** How many times the agent has attempted this task so far. */
  attempts: z.number().default(0),
  /** Upper bound on attempts before marking the task `failed`. */
  maxAttempts: z.number().default(3),
  /** Validation error output from the most recent failed attempt. */
  error: z.string().optional(),
  /** ISO-8601 timestamp set when the task passes validation. */
  completedAt: z.string().optional(),
});

export type Task = z.infer<typeof Task>;

/**
 * Project-level metadata from the `## Meta` section of a PRD.
 * Commands declared here are used by the validation pipeline.
 */
export const PRDMeta = z.object({
  /** e.g. "React, TypeScript, pnpm" — injected into every task prompt. */
  techStack: z.string(),
  /** Test runner binary name (used to build the `test` validation command). */
  testFramework: z.string().default('vitest'),
  /** Shell command executed for the `lint` validation step. */
  lintCommand: z.string().default('pnpm lint'),
  /** Shell command executed for the `build` validation step. */
  buildCommand: z.string().default('pnpm build'),
  /** Shell command executed for the `typecheck` validation step. */
  typecheckCommand: z.string().default('pnpm typecheck'),
  /** Working directory for all commands (relative to the PRD file). */
  projectRoot: z.string().default('./'),
});

export type PRDMeta = z.infer<typeof PRDMeta>;

/**
 * Top-level structure of a parsed PRD (Product Requirements Document).
 * Produced by {@link parsePRDFile} and consumed by the executor loop.
 */
export const PRD = z.object({
  /** Extracted from the `# Project: <name>` heading. */
  projectName: z.string(),
  /** Build/test/lint commands and project metadata. */
  meta: PRDMeta,
  /** Freeform architectural context injected into every task prompt. */
  context: z.string(),
  /** Ordered list of tasks to execute. */
  tasks: z.array(Task),
});

export type PRD = z.infer<typeof PRD>;
