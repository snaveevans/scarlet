import { z } from 'zod';
import type { LLMClient } from '../llm/client.js';
import type { Task } from '../prd/schemas.js';
import {
  buildSelfReviewPrompt,
  SELF_REVIEW_SYSTEM_PROMPT,
} from './prompts.js';

export interface SelfReviewOptions {
  prdContent: string;
  acceptanceCriteria: string[];
  diff: string;
  llmClient: LLMClient;
  model?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

const FixItemSchema = z.object({
  file: z.string(),
  issue: z.string(),
  severity: z.enum(['must-fix', 'should-fix', 'nit']),
});

export type FixItem = z.infer<typeof FixItemSchema>;

const ACStatusSchema = z.object({
  ac: z.string(),
  satisfied: z.boolean(),
  evidence: z.string(),
});

export type ACStatus = z.infer<typeof ACStatusSchema>;

const ReviewResultSchema = z.object({
  approved: z.boolean(),
  acStatus: z.array(ACStatusSchema),
  scopeCreep: z.array(z.string()).default([]),
  codeSmells: z.array(z.string()).default([]),
  fixList: z.array(FixItemSchema).default([]),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export async function runSelfReview(
  options: SelfReviewOptions,
): Promise<ReviewResult> {
  const prompt = buildSelfReviewPrompt(options);

  const response = await options.llmClient.complete({
    messages: [{ role: 'user', content: prompt }],
    system: SELF_REVIEW_SYSTEM_PROMPT,
    model: options.model,
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');

  return parseReviewResult(text);
}

export function parseReviewResult(raw: string): ReviewResult {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Self-review returned invalid JSON:\n${raw.slice(0, 500)}`);
  }

  const result = ReviewResultSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Self-review output failed validation:\n${issues}`);
  }

  return result.data;
}

export function reviewFixesToTasks(
  review: ReviewResult,
  cycle: number,
): Task[] {
  return review.fixList.map((fix, index) => {
    const taskId = `R${cycle}-${String(index + 1).padStart(3, '0')}`;
    return {
      id: taskId,
      title: `Review fix: ${truncate(fix.issue, 64)}`,
      depends: [],
      files: fix.file ? [fix.file] : [],
      description: `Resolve ${fix.severity} review issue in ${fix.file}: ${fix.issue}`,
      acceptanceCriteria: [`Review issue resolved: ${fix.issue}`],
      tests: [],
      status: 'pending',
      attempts: 0,
      maxAttempts: fix.severity === 'must-fix' ? 2 : 1,
    };
  });
}

function stripCodeFence(value: string): string {
  if (!value.startsWith('```')) return value;
  return value
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
