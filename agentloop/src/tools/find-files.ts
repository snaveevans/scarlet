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

const DEFAULT_MAX_RESULTS = 100;

export const findFilesTool: ToolHandler = {
  name: 'find_files',
  description:
    'Find files matching a glob-like pattern. Returns a list of matching file paths ' +
    'relative to the project root. Searches recursively by default.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'File name pattern to match. Supports * wildcard (e.g. "*.test.ts", "*.tsx").',
      },
      path: {
        type: 'string',
        description: 'Directory to search in, relative to project root. Default: "."',
      },
      max_results: {
        type: 'number',
        description: `Maximum files to return. Default: ${DEFAULT_MAX_RESULTS}.`,
      },
    },
    required: ['pattern'],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const pattern = input.pattern;
    if (typeof pattern !== 'string') {
      throw new Error('pattern must be a string');
    }

    const searchPath =
      typeof input.path === 'string' ? input.path : '.';
    const maxResults =
      typeof input.max_results === 'number'
        ? input.max_results
        : DEFAULT_MAX_RESULTS;

    const resolved = safePath(context.projectRoot, searchPath);
    const regex = globToRegex(pattern);
    const matches: string[] = [];

    findRecursive(resolved, context.projectRoot, regex, maxResults, matches);

    if (matches.length === 0) {
      return 'No files found matching the pattern.';
    }

    return matches.join('\n');
  },
};

function findRecursive(
  dir: string,
  projectRoot: string,
  regex: RegExp,
  maxResults: number,
  output: string[],
): void {
  if (output.length >= maxResults) return;

  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return;
  }

  items.sort();

  for (const item of items) {
    if (output.length >= maxResults) return;
    if (DEFAULT_IGNORE.has(item)) continue;

    const fullPath = join(dir, item);

    let isDir = false;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      findRecursive(fullPath, projectRoot, regex, maxResults, output);
    } else if (regex.test(item)) {
      output.push(relative(projectRoot, fullPath));
    }
  }
}

/** Convert a simple glob pattern (with * wildcards) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`);
}

export { globToRegex };
