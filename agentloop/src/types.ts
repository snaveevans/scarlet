import { z } from 'zod';
import { Task } from './prd/schemas.js';

export { Task, TaskStatus, PRD, PRDMeta } from './prd/schemas.js';

export const LoopState = z.object({
  prdFile: z.string(),
  startedAt: z.string(),
  lastUpdated: z.string(),
  currentTaskId: z.string().nullable(),
  tasks: z.array(Task),
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    pending: z.number(),
  }),
});

export type LoopState = z.infer<typeof LoopState>;

export const AgentLoopConfig = z.object({
  agent: z.string().default('opencode'),
  maxAttempts: z.number().int().positive().default(3),
  autoCommit: z.boolean().default(true),
  branch: z.string().optional(),
  skipFailedDeps: z.boolean().default(true),
  validationSteps: z
    .array(z.enum(['typecheck', 'lint', 'test', 'build']))
    .default(['typecheck', 'lint', 'test', 'build']),
  contextBudget: z.number().int().positive().default(12000),
  taskTimeout: z.number().int().positive().default(600000),
  validationTimeout: z.number().int().positive().default(60000),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
});

export type AgentLoopConfig = z.infer<typeof AgentLoopConfig>;

export interface ValidationStep {
  name: string;
  command: string;
  required: boolean;
  timeoutMs: number;
}

export interface ValidationResult {
  step: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface PipelineResult {
  allPassed: boolean;
  results: ValidationResult[];
  errors: string[];
}

export interface AgentResult {
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}
