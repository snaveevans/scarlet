import { z } from 'zod';

export const AcceptanceCriterion = z.object({
  id: z.string().regex(/^AC-\d+$/i),
  description: z.string().min(1),
});

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const ADR = z.object({
  id: z.string().regex(/^ADR-\d+$/i),
  title: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().min(1),
});

export type ADR = z.infer<typeof ADR>;

export const Constraint = z.object({
  description: z.string().min(1),
});

export type Constraint = z.infer<typeof Constraint>;

export const PRDv2 = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  acceptanceCriteria: z.array(AcceptanceCriterion).min(1),
  constraints: z.array(Constraint).default([]),
  adrs: z.array(ADR).default([]),
  notes: z.string().optional(),
});

export type PRDv2 = z.infer<typeof PRDv2>;
