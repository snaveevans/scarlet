import { readFileSync } from 'node:fs';
import { PRD, PRDMeta, Task } from './schemas.js';
import type { PRD as PRDType, Task as TaskType, PRDMeta as PRDMetaType } from './schemas.js';
import { extractSection } from '../utils/markdown.js';

/**
 * Parse a PRD markdown file into a structured PRD object.
 */
export function parsePRDFile(filePath: string): PRDType {
  const content = readFileSync(filePath, 'utf-8');
  return parsePRD(content);
}

export function parsePRD(content: string): PRDType {
  const projectName = extractProjectName(content);
  const meta = extractMeta(content);
  const context = extractContext(content);
  const tasks = extractTasks(content);

  return PRD.parse({ projectName, meta, context, tasks });
}

function extractProjectName(content: string): string {
  const match = /^#\s+Project:\s+(.+)$/m.exec(content);
  if (!match || !match[1]) {
    throw new Error('PRD must have a "# Project: <name>" heading');
  }
  return match[1].trim();
}

function extractMeta(content: string): PRDMetaType {
  const rawSection = extractSection(content, 'Meta');
  if (!rawSection) {
    return PRDMeta.parse({ techStack: 'Unknown' });
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const metaSection = rawSection!;

  function extractField(fieldName: string): string | undefined {
    const pattern = new RegExp(
      `^\\s*[-*]\\s*\\*\\*${fieldName}:\\*\\*\\s*(.+)$`,
      'mi',
    );
    const match = pattern.exec(metaSection);
    return match?.[1]?.trim();
  }

  return PRDMeta.parse({
    techStack: extractField('Tech Stack') ?? 'Unknown',
    testFramework: extractField('Test Framework'),
    lintCommand: extractField('Lint Command'),
    buildCommand: extractField('Build Command'),
    typecheckCommand: extractField('Typecheck Command'),
    projectRoot: extractField('Project Root'),
  });
}

function extractContext(content: string): string {
  return extractSection(content, 'Context') ?? '';
}

function extractTasks(content: string): TaskType[] {
  const tasksSection = extractSection(content, 'Tasks');
  if (!tasksSection) {
    return [];
  }

  // Split by ### Task headers — each block starts with "Task N: title"
  const taskBlocks = tasksSection.split(/^###\s+/m).filter(Boolean);

  return taskBlocks
    .map((block) => parseTaskBlock(block))
    .filter((t): t is TaskType => t !== null);
}

function parseTaskBlock(block: string): TaskType | null {
  const lines = block.trim().split('\n');
  const firstLine = lines[0];
  if (!firstLine) return null;

  // Title is the first line (after "### " was stripped)
  const titleMatch = /^Task\s+\d+:\s+(.+)$/.exec(firstLine.trim());
  const title = titleMatch?.[1]?.trim() ?? firstLine.trim();

  function extractField(fieldName: string): string | undefined {
    const pattern = new RegExp(
      `^\\s*[-*]\\s*\\*\\*${fieldName}:\\*\\*\\s*(.*)$`,
      'mi',
    );
    const match = pattern.exec(block);
    return match?.[1]?.trim() || undefined;
  }

  const id = extractField('ID');
  if (!id) return null;

  const dependsRaw = extractField('Depends');
  const depends =
    dependsRaw && dependsRaw.toLowerCase() !== 'none'
      ? dependsRaw.split(',').map((d) => d.trim()).filter(Boolean)
      : [];

  const filesRaw = extractField('Files');
  const files = filesRaw
    ? filesRaw.split(',').map((f) => f.trim()).filter(Boolean)
    : [];

  const description = extractField('Description') ?? '';

  const acceptanceCriteria = extractListSection(block, 'Acceptance Criteria');
  const tests = extractTestList(block);

  return Task.parse({
    id,
    title,
    depends,
    files,
    description,
    acceptanceCriteria,
    tests,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
  });
}

/**
 * Extract a named list section (lines prefixed with "  - ") from a block.
 */
function extractListSection(block: string, sectionName: string): string[] {
  const sectionPattern = new RegExp(
    `\\*\\*${sectionName}:\\*\\*\\s*\\n((?:[ \\t]*[-*][ \\t]+.+\\n?)+)`,
    'i',
  );
  const match = sectionPattern.exec(block);
  if (!match || !match[1]) return [];

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);
}

/**
 * Extract test entries from the Tests subsection.
 * Format: `  - \`path/to/test.ts\` — description`
 */
function extractTestList(block: string): string[] {
  const sectionPattern =
    /\*\*Tests:\*\*\s*\n((?:[ \t]*[-*][ \t]+.+\n?)+)/i;
  const match = sectionPattern.exec(block);
  if (!match || !match[1]) return [];

  return match[1]
    .split('\n')
    .map((line) => {
      const stripped = line.replace(/^\s*[-*]\s+/, '').trim();
      // Extract path from backtick notation: `path/to/test.ts` — description
      const backtickMatch = /^`([^`]+)`/.exec(stripped);
      if (backtickMatch?.[1]) return backtickMatch[1].trim();
      // Fall back to path before first space/dash
      return stripped.split(/\s+—|\s+-/)[0]?.trim() ?? stripped;
    })
    .filter(Boolean);
}

