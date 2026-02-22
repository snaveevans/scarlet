import { readFileSync } from 'node:fs';
import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';

export const readFileTool: ToolHandler = {
  name: 'read_file',
  description:
    'Read the contents of a file. Returns the file content as text. ' +
    'Optionally specify offset (1-based line number) and limit (number of lines) to read a portion.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the project root.',
      },
      offset: {
        type: 'number',
        description: 'Start reading from this line number (1-based). Optional.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to return. Optional.',
      },
    },
    required: ['path'],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const filePath = input.path;
    if (typeof filePath !== 'string') {
      throw new Error('path must be a string');
    }

    const resolved = safePath(context.projectRoot, filePath);

    let content: string;
    try {
      content = readFileSync(resolved, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot read file "${filePath}": ${msg}`);
    }

    const lines = content.split('\n');
    const offset =
      typeof input.offset === 'number' ? Math.max(1, input.offset) : 1;
    const limit =
      typeof input.limit === 'number' ? input.limit : lines.length;

    const slice = lines.slice(offset - 1, offset - 1 + limit);
    return slice.join('\n');
  },
};
