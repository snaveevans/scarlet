import type { ImplementationPlan } from '../comprehension/types.js';
import type { Task } from '../types.js';

const MAX_DIFF_CHARS = 50000;
const MAX_PROGRESS_LOG_CHARS = 15000;
const MAX_PLAN_CHARS = 12000;

export interface ReflectionPromptOptions {
  prdName: string;
  tasks: Task[];
  plan: ImplementationPlan;
  diff: string;
  progressLog: string;
}

export const REFLECTION_SYSTEM_PROMPT = `You are extracting reusable knowledge from an agent run.

Return STRICT JSON only (no markdown, no prose) with this shape:
{
  "skills": [
    {
      "name": "string",
      "description": "string",
      "trigger": ["string"],
      "content": "string",
      "tags": ["string"],
      "references": ["relative/path.ts"]
    }
  ],
  "pitfalls": [
    {
      "description": "string",
      "context": "string",
      "rootCause": "string",
      "avoidance": "string",
      "severity": "low|medium|high",
      "tags": ["string"],
      "references": ["relative/path.ts"]
    }
  ],
  "toolCandidates": ["string"],
  "contextUpdates": ["string"]
}

Extraction rules:
- Skills: reusable patterns/checklists discovered during this run that future runs should know.
- Pitfalls: only include meaningful mistakes or retry causes and how to avoid them.
- Tool candidates: repeated mechanical workflows that could become tools later.
- Context updates: concise conventions or project facts to add to .scarlet/context.md.
- Keep entries specific and actionable.`;

export function buildReflectionPrompt(options: ReflectionPromptOptions): string {
  return [
    `## PRD`,
    options.prdName,
    '',
    '## Task Outcomes',
    summarizeTasks(options.tasks),
    '',
    '## Plan Summary',
    truncate(summarizePlan(options.plan), MAX_PLAN_CHARS),
    '',
    '## Diff',
    truncate(options.diff, MAX_DIFF_CHARS),
    '',
    '## Progress Log',
    truncate(options.progressLog, MAX_PROGRESS_LOG_CHARS),
    '',
    'Now produce the JSON reflection result.',
  ].join('\n');
}

function summarizeTasks(tasks: Task[]): string {
  if (tasks.length === 0) return '- (no tasks)';
  return tasks
    .map((task) => `- ${task.id} | ${task.status} | attempts=${task.attempts} | ${task.title}`)
    .join('\n');
}

function summarizePlan(plan: ImplementationPlan): string {
  const taskLines = plan.tasks.map(
    (task) =>
      `- ${task.id}: ${task.title} [ac=${task.satisfiesAC.join(', ') || 'none'}] [depends=${task.dependsOn.join(', ') || 'none'}]`,
  );
  const decisionLines = plan.decisions.map(
    (decision) => `- ${decision.decision}: ${decision.rationale}`,
  );

  return [
    `Tasks (${plan.tasks.length}):`,
    taskLines.join('\n') || '- (none)',
    '',
    `Decisions (${plan.decisions.length}):`,
    decisionLines.join('\n') || '- (none)',
  ].join('\n');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... [truncated]`;
}
