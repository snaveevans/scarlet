/**
 * Types for the comprehension phase (Phase 0).
 *
 * The comprehension phase takes a PRD and produces an implementation plan
 * by exploring the codebase and decomposing acceptance criteria into tasks.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Codebase Understanding (output of Explore step)
// ---------------------------------------------------------------------------

export const ProjectCommandsSchema = z.object({
  typecheck: z.string().optional(),
  lint: z.string().optional(),
  test: z.string().optional(),
  build: z.string().optional(),
});

export const ProjectInfoSchema = z.object({
  packageManager: z.string(),
  framework: z.string(),
  language: z.string(),
  testFramework: z.string(),
  buildTool: z.string(),
  commands: ProjectCommandsSchema,
});

export const ConventionsSchema = z.object({
  fileOrganization: z.string(),
  testOrganization: z.string(),
  importStyle: z.string(),
});

export const RelevantCodeSchema = z.object({
  path: z.string(),
  purpose: z.string(),
  keyExports: z.array(z.string()),
});

export const CodebaseUnderstandingSchema = z.object({
  project: ProjectInfoSchema,
  conventions: ConventionsSchema,
  relevantCode: z.array(RelevantCodeSchema),
});

export type CodebaseUnderstanding = z.infer<typeof CodebaseUnderstandingSchema>;

// ---------------------------------------------------------------------------
// Implementation Plan (output of Decompose step)
// ---------------------------------------------------------------------------

export const PlannedTestSchema = z.object({
  file: z.string(),
  description: z.string(),
});

export const PlannedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  satisfiesAC: z.array(z.string()),
  dependsOn: z.array(z.string()).default([]),
  filesToCreate: z.array(z.string()).default([]),
  filesToModify: z.array(z.string()).default([]),
  tests: z.array(PlannedTestSchema).default([]),
  complexity: z.enum(['low', 'medium', 'high']).default('medium'),
  risks: z.array(z.string()).default([]),
});

export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

export const DecisionSchema = z.object({
  decision: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).default([]),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const ACCoverageSchema = z.object({
  ac: z.string(),
  coveredByTasks: z.array(z.string()),
});

export const ImplementationPlanSchema = z.object({
  tasks: z.array(PlannedTaskSchema).min(1),
  acCoverage: z.array(ACCoverageSchema),
  decisions: z.array(DecisionSchema).default([]),
});

export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;

// ---------------------------------------------------------------------------
// Comprehension input — what we need from the PRD
// ---------------------------------------------------------------------------

export interface ComprehensionInput {
  /** Feature name. */
  name: string;
  /** One-paragraph summary of the feature. */
  summary: string;
  /** Acceptance criteria (the testable statements). */
  acceptanceCriteria: { id: string; description: string }[];
  /** Constraints the implementation must satisfy. */
  constraints: string[];
  /** Architectural decisions already made. */
  adrs: { id: string; title: string; decision: string; rationale: string }[];
  /** Freeform notes/hints. */
  notes: string;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface PlanValidationResult {
  valid: boolean;
  issues: PlanIssue[];
}

export interface PlanIssue {
  severity: 'error' | 'warning';
  message: string;
}
