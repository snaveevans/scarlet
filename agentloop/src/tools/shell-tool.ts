import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';
import { runShellCommand } from '../utils/shell.js';

const DEFAULT_TIMEOUT_MS = 30000;

export const shellTool: ToolHandler = {
  name: 'shell',
  description:
    'Run a shell command in the project directory. Returns stdout, stderr, and exit code. ' +
    'Use for running tests, builds, linters, or other project commands.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      working_dir: {
        type: 'string',
        description: 'Working directory relative to project root. Default: project root.',
      },
      timeout_ms: {
        type: 'number',
        description: `Timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}.`,
      },
    },
    required: ['command'],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const command = input.command;
    if (typeof command !== 'string') {
      throw new Error('command must be a string');
    }

    const workingDir =
      typeof input.working_dir === 'string'
        ? safePath(context.projectRoot, input.working_dir)
        : context.projectRoot;

    const timeoutMs =
      typeof input.timeout_ms === 'number'
        ? input.timeout_ms
        : DEFAULT_TIMEOUT_MS;

    const result = await runShellCommand(command, {
      cwd: workingDir,
      timeoutMs,
    });

    const parts: string[] = [];

    if (result.timedOut) {
      parts.push(`[TIMED OUT after ${timeoutMs}ms]`);
    }

    parts.push(`Exit code: ${result.exitCode}`);

    if (result.stdout) {
      parts.push(`\nstdout:\n${result.stdout}`);
    }

    if (result.stderr) {
      parts.push(`\nstderr:\n${result.stderr}`);
    }

    return parts.join('\n');
  },
};
