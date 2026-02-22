import { z } from 'zod';
import { Task } from './prd/schemas.js';

export { Task, TaskStatus, PRD, PRDMeta } from './prd/schemas.js';

/**
 * Persisted snapshot of the entire execution loop.
 *
 * Written atomically to `.agentloop/state.json` after every state change so
 * that runs can be resumed with `agentloop resume` if the process is
 * interrupted. The `summary` object is recomputed from `tasks` on every write.
 */
export const LoopState = z.object({
  /** Absolute path to the PRD file that started this run. */
  prdFile: z.string(),
  /** ISO-8601 timestamp when the run was first started. */
  startedAt: z.string(),
  /** ISO-8601 timestamp of the most recent state mutation. */
  lastUpdated: z.string(),
  /** ID of the task currently being executed, or `null` between tasks. */
  currentTaskId: z.string().nullable(),
  /** Full task list with live status, attempt counts, and error output. */
  tasks: z.array(Task),
  /** Aggregate counters derived from the task list. */
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    /** Includes both `pending` and `in_progress` tasks. */
    pending: z.number(),
  }),
});

export type LoopState = z.infer<typeof LoopState>;

/**
 * Runtime configuration for the execution loop.
 *
 * Values are resolved with the following precedence (highest wins):
 * 1. CLI flags
 * 2. `.agentloop/config.json` in the project root
 * 3. Built-in defaults (shown below)
 */
/**
 * LLM provider and model configuration.
 *
 * Used by the native Scarlet agent (Phase 1+). When the agent adapter is
 * `"scarlet"`, these settings control which model is called.
 */
export const LLMConfig = z.object({
  /** Provider name (e.g. `"anthropic"` or `"openai"`). */
  provider: z.string().default('anthropic'),
  /** Model identifier passed to the provider. */
  model: z.string().default('claude-sonnet-4-5-20250929'),
  /** Maximum tokens the model may generate per turn. */
  maxTokens: z.number().int().positive().default(8192),
  /** Sampling temperature (0 = deterministic). */
  temperature: z.number().min(0).max(2).default(0),
});

export type LLMConfig = z.infer<typeof LLMConfig>;

export const AgentLoopConfig = z.object({
  /** Agent adapter name (`"scarlet"` for native agent, `"opencode"` for legacy). */
  agent: z.string().default('opencode'),
  /** Max retry attempts per task before marking it `failed`. */
  maxAttempts: z.number().int().positive().default(3),
  /** Whether to `git commit` after each passing task. */
  autoCommit: z.boolean().default(true),
  /** Git branch name. Defaults to `agentloop/<prd-name>`. */
  branch: z.string().optional(),
  /** Skip tasks whose dependencies have failed. */
  skipFailedDeps: z.boolean().default(true),
  /** Ordered list of validation steps to run after each agent attempt. */
  validationSteps: z
    .array(z.enum(['typecheck', 'lint', 'test', 'build']))
    .default(['typecheck', 'lint', 'test', 'build']),
  /** Approximate token budget for the context injected into each task prompt. */
  contextBudget: z.number().int().positive().default(12000),
  /** Milliseconds before the agent process is killed (default 10 min). */
  taskTimeout: z.number().int().positive().default(600000),
  /** Milliseconds before a single validation step is killed (default 60 s). */
  validationTimeout: z.number().int().positive().default(60000),
  /** Parse the PRD and print the execution plan without running anything. */
  dryRun: z.boolean().default(false),
  /** Stream agent stdout/stderr to the terminal in real time. */
  verbose: z.boolean().default(false),
  /** LLM provider/model configuration for the native Scarlet agent. */
  llm: LLMConfig.default({}),
});

export type AgentLoopConfig = z.infer<typeof AgentLoopConfig>;

/** A single step in the validation pipeline (typecheck, lint, test, or build). */
export interface ValidationStep {
  name: string;
  /** Shell command to execute (e.g. `pnpm typecheck`). */
  command: string;
  /** If `true`, failure causes the remaining pipeline steps to be skipped. */
  required: boolean;
  timeoutMs: number;
}

/** Result of running one validation step. */
export interface ValidationResult {
  step: string;
  passed: boolean;
  /** Combined stdout + stderr, or a timeout message. */
  output: string;
  durationMs: number;
}

/** Aggregate result of the full validation pipeline for one task attempt. */
export interface PipelineResult {
  /** `true` only when every step passed. */
  allPassed: boolean;
  /** One entry per pipeline step, in execution order. */
  results: ValidationResult[];
  /** Formatted error blocks for each failing step (`[stepName]\n<output>`). */
  errors: string[];
}

/** Result returned by an {@link AgentAdapter.execute} call. */
export interface AgentResult {
  /** `true` when the agent process exited with code 0 and did not time out. */
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Low-level result of a spawned shell command. */
export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** `true` if the process was killed because it exceeded its timeout. */
  timedOut: boolean;
}
