import { z } from 'zod';

export const TaskStatus = z.enum([
  'pending',
  'in_progress',
  'passed',
  'failed',
  'skipped',
]);

export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  depends: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  tests: z.array(z.string()).default([]),
  status: TaskStatus.default('pending'),
  attempts: z.number().default(0),
  maxAttempts: z.number().default(3),
  error: z.string().optional(),
  completedAt: z.string().optional(),
});

export type Task = z.infer<typeof Task>;

export const PRDMeta = z.object({
  techStack: z.string(),
  testFramework: z.string().default('vitest'),
  lintCommand: z.string().default('pnpm lint'),
  buildCommand: z.string().default('pnpm build'),
  typecheckCommand: z.string().default('pnpm typecheck'),
  projectRoot: z.string().default('./'),
});

export type PRDMeta = z.infer<typeof PRDMeta>;

export const PRD = z.object({
  projectName: z.string(),
  meta: PRDMeta,
  context: z.string(),
  tasks: z.array(Task),
});

export type PRD = z.infer<typeof PRD>;
