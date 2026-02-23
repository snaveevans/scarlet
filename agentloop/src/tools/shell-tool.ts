import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';
import { runShellCommand } from '../utils/shell.js';

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Patterns that indicate dangerous shell commands. Each entry is a regex
 * tested against the full command string. The denylist is intentionally
 * conservative — it blocks commands that are almost never required during
 * normal code-generation tasks but could cause severe damage if invoked by
 * a prompt-injected or hallucinating LLM.
 */
const DENIED_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[^\s]*\s+)*-[^\s]*r/i,   // rm -rf, rm -r, rm --recursive
  /\brm\s+-rf\b/i,                     // explicit rm -rf
  /\bsudo\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmkfs\b/i,
  /\bdd\b\s/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b\s/i,                         // netcat
  /\b(python|node|ruby|perl)\s+-e\b/i, // inline script execution
  />\s*\/dev\/sd/i,                     // writing to block devices
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkill\s+-9\b/i,
  /\bkillall\b/i,
  /\bpkill\b/i,
];

export const shellTool: ToolHandler = {
  name: 'shell',
  description:
    'Run a shell command in the project directory. Returns stdout, stderr, and exit code. ' +
    'Use for running tests, builds, linters, or other project commands. ' +
    'Dangerous commands (rm -rf, curl, sudo, etc.) are blocked.',
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

    const denied = DENIED_COMMAND_PATTERNS.find((pattern) => pattern.test(command));
    if (denied) {
      throw new Error(
        `Command blocked by safety filter: "${command}". ` +
        `Dangerous operations (rm -rf, curl, sudo, etc.) are not allowed.`,
      );
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
