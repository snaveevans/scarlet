import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';
import { runShell } from '../utils/shell.js';

const DEFAULT_MAX_RESULTS = 50;

export const searchFilesTool: ToolHandler = {
  name: 'search_files',
  description:
    'Search file contents for a pattern (like grep). Returns matching lines ' +
    'with file path and line number. Uses ripgrep (rg) if available, falls back to grep.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in, relative to project root. Default: "."',
      },
      file_pattern: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.tsx", "*.ts"). Optional.',
      },
      max_results: {
        type: 'number',
        description: `Maximum number of results to return. Default: ${DEFAULT_MAX_RESULTS}.`,
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
    const filePattern =
      typeof input.file_pattern === 'string' ? input.file_pattern : undefined;
    const maxResults =
      typeof input.max_results === 'number'
        ? input.max_results
        : DEFAULT_MAX_RESULTS;

    // Validate path doesn't escape
    safePath(context.projectRoot, searchPath);

    // Try rg first, fall back to grep
    const result = await tryRipgrep(
      pattern,
      searchPath,
      filePattern,
      maxResults,
      context,
    );

    if (result !== null) return result;

    return tryGrep(
      pattern,
      searchPath,
      filePattern,
      maxResults,
      context,
    );
  },
};

async function tryRipgrep(
  pattern: string,
  searchPath: string,
  filePattern: string | undefined,
  maxResults: number,
  context: ToolContext,
): Promise<string | null> {
  const args = [
    '-n',                          // line numbers
    '--no-heading',
    '--color', 'never',
    '-m', String(maxResults),      // max matches per file
  ];

  if (filePattern) {
    args.push('--glob', filePattern);
  }

  args.push('--', pattern, searchPath);

  const result = await runShell('rg', args, {
    cwd: context.projectRoot,
    timeoutMs: 15000,
  });

  // rg not found
  if (result.stderr.includes('not found') || result.exitCode === 127) {
    return null;
  }

  // No matches
  if (result.exitCode === 1 && result.stdout === '') {
    return 'No matches found.';
  }

  if (result.stdout === '') {
    return 'No matches found.';
  }

  const lines = result.stdout.split('\n');
  const truncated = lines.slice(0, maxResults);
  const suffix =
    lines.length > maxResults
      ? `\n... (${lines.length - maxResults} more results truncated)`
      : '';

  return truncated.join('\n') + suffix;
}

async function tryGrep(
  pattern: string,
  searchPath: string,
  filePattern: string | undefined,
  maxResults: number,
  context: ToolContext,
): Promise<string> {
  const args = [
    '-rn',
    '--color=never',
    '-m', String(maxResults),
  ];

  if (filePattern) {
    args.push('--include', filePattern);
  }

  args.push('--', pattern, searchPath);

  const result = await runShell('grep', args, {
    cwd: context.projectRoot,
    timeoutMs: 15000,
  });

  if (result.stdout === '') {
    return 'No matches found.';
  }

  const lines = result.stdout.split('\n');
  const truncated = lines.slice(0, maxResults);
  const suffix =
    lines.length > maxResults
      ? `\n... (${lines.length - maxResults} more results truncated)`
      : '';

  return truncated.join('\n') + suffix;
}
