import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
]);

export const listDirectoryTool: ToolHandler = {
  name: 'list_directory',
  description:
    'List the contents of a directory. Returns file and directory names. ' +
    'Use recursive: true to list subdirectories (up to max_depth).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to the project root. Default: "."',
      },
      recursive: {
        type: 'boolean',
        description: 'List subdirectories recursively. Default: false.',
      },
      max_depth: {
        type: 'number',
        description: 'Maximum recursion depth (only with recursive: true). Default: 3.',
      },
    },
    required: [],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const dirPath =
      typeof input.path === 'string' ? input.path : '.';
    const recursive = input.recursive === true;
    const maxDepth =
      typeof input.max_depth === 'number' ? input.max_depth : 3;

    const resolved = safePath(context.projectRoot, dirPath);
    const entries: string[] = [];

    listDir(resolved, context.projectRoot, recursive, maxDepth, 0, entries);

    if (entries.length === 0) {
      return '(empty directory)';
    }

    return entries.join('\n');
  },
};

function listDir(
  dir: string,
  projectRoot: string,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number,
  output: string[],
): void {
  let items: string[];
  try {
    items = readdirSync(dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot list directory: ${msg}`);
  }

  items.sort();

  for (const item of items) {
    if (DEFAULT_IGNORE.has(item)) continue;

    const fullPath = join(dir, item);
    const relPath = relative(projectRoot, fullPath);

    let isDir = false;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue; // skip broken symlinks etc.
    }

    output.push(isDir ? `${relPath}/` : relPath);

    if (isDir && recursive && currentDepth < maxDepth) {
      listDir(fullPath, projectRoot, recursive, maxDepth, currentDepth + 1, output);
    }
  }
}
