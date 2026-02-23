import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';

export const writeFileTool: ToolHandler = {
  name: 'write_file',
  description:
    'Write content to a file, creating it if it does not exist. ' +
    'Parent directories are created automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the project root.',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file.',
      },
    },
    required: ['path', 'content'],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const filePath = input.path;
    const content = input.content;

    if (typeof filePath !== 'string') {
      throw new Error('path must be a string');
    }
    if (typeof content !== 'string') {
      throw new Error('content must be a string');
    }

    const resolved = safePath(context.projectRoot, filePath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content, 'utf-8');

    return `File written: ${filePath}`;
  },
};
