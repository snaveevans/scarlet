import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, PRD } from '../types.js';

export interface ContextBuilderOptions {
  task: Task;
  prd: PRD;
  recentTasks: Task[];
  isRetry: boolean;
  contextBudget: number;
  projectRoot: string;
}

/**
 * Rough token estimate: 1 token ≈ 4 chars
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... [truncated]';
}

export function buildPrompt(options: ContextBuilderOptions): string {
  const { task, prd, recentTasks, isRetry, contextBudget, projectRoot } =
    options;

  const sections: string[] = [];
  let usedTokens = 0;

  // 1. Task definition (always included)
  const taskSection = buildTaskSection(task);
  usedTokens += estimateTokens(taskSection);
  sections.push(taskSection);

  // 2. Project context (always included)
  const contextSection = `## Project Context\n${prd.context}`;
  usedTokens += estimateTokens(contextSection);
  sections.push(contextSection);

  // 3. Tech stack
  const techSection = `## Tech Stack\n${prd.meta.techStack}`;
  usedTokens += estimateTokens(techSection);
  sections.push(techSection);

  // 4. Previous error output (if retry)
  if (isRetry && task.error) {
    const errorSection = buildErrorSection(task.error);
    usedTokens += estimateTokens(errorSection);
    sections.push(errorSection);
  }

  // 5. Recent progress
  if (recentTasks.length > 0) {
    const progressSection = buildProgressSection(recentTasks);
    usedTokens += estimateTokens(progressSection);
    sections.push(progressSection);
  }

  // 6. File contents (if budget allows)
  const remainingBudget = contextBudget - usedTokens;
  if (remainingBudget > 500 && task.files.length > 0) {
    const fileSection = buildFileSection(task.files, projectRoot, remainingBudget);
    if (fileSection) {
      sections.push(fileSection);
    }
  }

  // 7. Instructions
  sections.push(INSTRUCTIONS);

  return sections.join('\n\n');
}

function buildTaskSection(task: Task): string {
  const lines = [
    `You are implementing a task in an existing codebase.\n`,
    `## Current Task`,
    `**${task.id}: ${task.title}**\n`,
    task.description,
  ];

  if (task.files.length > 0) {
    lines.push(`\n### Files to create or modify:`);
    lines.push(task.files.join('\n'));
  }

  if (task.acceptanceCriteria.length > 0) {
    lines.push(`\n### Acceptance Criteria:`);
    lines.push(task.acceptanceCriteria.map((c) => `- ${c}`).join('\n'));
  }

  if (task.tests.length > 0) {
    lines.push(`\n### Tests that must pass:`);
    lines.push(task.tests.map((t) => `- ${t}`).join('\n'));
  }

  return lines.join('\n');
}

function buildErrorSection(error: string): string {
  return [
    `## Previous Attempt Failed`,
    `The previous attempt failed validation with the following errors:`,
    '```',
    error,
    '```',
    `Fix these issues. Do not re-implement from scratch — fix the specific problems.`,
  ].join('\n');
}

function buildProgressSection(recentTasks: Task[]): string {
  const lines = ['## Recently Completed'];
  for (const t of recentTasks) {
    lines.push(
      `- **${t.id}: ${t.title}** — Files: ${t.files.join(', ') || 'none'}`,
    );
  }
  return lines.join('\n');
}

function buildFileSection(
  files: string[],
  projectRoot: string,
  budgetTokens: number,
): string | null {
  const contents: string[] = ['## Existing File Contents'];
  let used = estimateTokens(contents[0]!);

  for (const filePath of files) {
    const fullPath = join(projectRoot, filePath);
    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const block = `### ${filePath}\n\`\`\`\n${content}\n\`\`\``;
      const tokens = estimateTokens(block);

      if (used + tokens > budgetTokens) {
        // Try to include a truncated version
        const remaining = budgetTokens - used;
        if (remaining > 200) {
          const truncated = truncateToTokenBudget(content, remaining - 50);
          contents.push(`### ${filePath}\n\`\`\`\n${truncated}\n\`\`\``);
        }
        break;
      }

      contents.push(block);
      used += tokens;
    } catch {
      // Skip unreadable files
    }
  }

  if (contents.length <= 1) return null;
  return contents.join('\n\n');
}

const INSTRUCTIONS = `## Instructions
- Implement ONLY this task. Do not modify files unrelated to this task.
- Do not refactor or improve code outside the scope of this task.
- Ensure all acceptance criteria are met.
- Write or update tests as specified.
- Follow existing code conventions and patterns in the project.
- If a file listed above doesn't exist, create it.
- If a file exists, modify only what's needed for this task.`;
