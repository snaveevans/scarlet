import { basename } from 'node:path';
import type { Task } from '../prd/schemas.js';

/**
 * Build a scaffold-focused prompt for agent-driven scaffolding workflows.
 */
export function buildScaffoldPrompt(tasks: Task[]): string {
  const lines: string[] = [
    'Create a project scaffold from the implementation tasks below.',
    '',
    'Rules:',
    '- Create missing files with minimal compilable stubs only',
    '- Create missing test files with describe/it.todo shells',
    '- Do not implement business logic',
    '- Preserve existing files unless explicitly listed',
    '',
    'Tasks:',
  ];

  for (const task of tasks) {
    lines.push(`- ${task.id}: ${task.title}`);
    if (task.files.length > 0) {
      lines.push(`  Files: ${task.files.join(', ')}`);
    }
    if (task.tests.length > 0) {
      lines.push(`  Tests: ${task.tests.join(', ')}`);
    }
  }

  const testFiles = Array.from(
    new Set(tasks.flatMap((task) => task.tests)),
  );
  if (testFiles.length > 0) {
    lines.push('');
    lines.push('Test todo shells to include:');
    for (const file of testFiles) {
      lines.push(`- ${basename(file)}`);
    }
  }

  return lines.join('\n');
}
