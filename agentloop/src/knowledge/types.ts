import { z } from 'zod';

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  trigger: z.array(z.string()).default([]),
  content: z.string(),
  projectSpecific: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  usageCount: z.number().int().nonnegative().default(0),
  lastUsed: z.string(),
  createdFrom: z.string(),
  tags: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});

export type Skill = z.infer<typeof SkillSchema>;

export const PitfallSchema = z.object({
  id: z.string(),
  description: z.string(),
  context: z.string(),
  rootCause: z.string(),
  avoidance: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  occurrences: z.number().int().nonnegative().default(1),
  createdFrom: z.string(),
  lastTriggered: z.string(),
  tags: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});

export type Pitfall = z.infer<typeof PitfallSchema>;

export const AgentToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['script', 'template', 'check']),
  inputSchema: z.record(z.unknown()),
  content: z.string(),
  usageCount: z.number().int().nonnegative().default(0),
  createdFrom: z.string(),
  lastUsed: z.string(),
  references: z.array(z.string()).default([]),
});

export type AgentTool = z.infer<typeof AgentToolSchema>;
