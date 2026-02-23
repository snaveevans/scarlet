import { readFileSync, writeFileSync } from 'node:fs';
import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';

export const editFileTool: ToolHandler = {
  name: 'edit_file',
  description:
    'Replace a string in a file. The old_string must appear exactly once ' +
    'in the file (unless replace_all is true). The file must already exist.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the project root.',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find and replace.',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences instead of requiring uniqueness. Default: false.',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const filePath = input.path;
    const oldStr = input.old_string;
    const newStr = input.new_string;
    const replaceAll = input.replace_all === true;

    if (typeof filePath !== 'string') throw new Error('path must be a string');
    if (typeof oldStr !== 'string') throw new Error('old_string must be a string');
    if (typeof newStr !== 'string') throw new Error('new_string must be a string');

    const resolved = safePath(context.projectRoot, filePath);

    let content: string;
    try {
      content = readFileSync(resolved, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot read file "${filePath}": ${msg}`);
    }

    if (!content.includes(oldStr)) {
      throw new Error(
        `old_string not found in "${filePath}". Make sure it matches the file contents exactly.`,
      );
    }

    if (!replaceAll) {
      const firstIdx = content.indexOf(oldStr);
      const secondIdx = content.indexOf(oldStr, firstIdx + 1);
      if (secondIdx !== -1) {
        throw new Error(
          `old_string appears multiple times in "${filePath}". ` +
          `Use replace_all: true to replace all occurrences, or provide more context to make it unique.`,
        );
      }
    }

    const updated = replaceAll
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);

    writeFileSync(resolved, updated, 'utf-8');

    const count = replaceAll
      ? content.split(oldStr).length - 1
      : 1;

    return `Replaced ${count} occurrence(s) in ${filePath}`;
  },
};
