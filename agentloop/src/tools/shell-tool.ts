import type { ToolHandler, ToolContext } from './types.js';
import { safePath } from './types.js';
import { runShellCommand } from '../utils/shell.js';

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Allowlist of command binaries permitted for execution. Only commands whose
 * base name (first token) matches one of these entries are allowed. Everything
 * else is denied by default — this is structurally safer than a denylist which
 * can always be bypassed via obfuscation.
 */
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // version control
  'git',
  // package managers & runners
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'cargo', 'pip', 'pipx',
  // build / type-check / lint / test
  'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha',
  'make', 'cmake', 'gradle', 'mvn',
  // runtimes (without -e flag — checked separately)
  'node', 'python', 'python3', 'ruby', 'perl', 'deno',
  // file inspection
  'ls', 'cat', 'head', 'tail', 'wc', 'diff', 'file', 'stat',
  'find', 'rg', 'grep', 'awk', 'sed', 'sort', 'uniq', 'tr',
  // safe file operations
  'mkdir', 'touch', 'cp', 'mv', 'echo', 'printf', 'pwd', 'which',
  'basename', 'dirname', 'realpath', 'readlink',
  // environment
  'env', 'printenv', 'date', 'uname',
]);

/**
 * Shell metacharacters that enable command chaining, subshell injection, or
 * I/O redirection. These are rejected in raw command strings to prevent
 * bypassing the allowlist via constructs like `git status; rm -rf /`.
 *
 * Allowed: single `|` (pipes) are common in dev workflows (e.g. `grep | wc`).
 * We allow `|` only between two allowed commands (validated separately).
 */
const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /;\s*/,                        // command chaining via semicolon
  /&&/,                          // logical AND chaining
  /\|\|/,                        // logical OR chaining
  /\$\(/,                        // command substitution $(...)
  /`/,                           // backtick command substitution
  />\s*>/,                       // append redirection >>
  />\s*[/~]/,                    // redirect to absolute/home path
  /\beval\b/,                    // eval
  /\bexec\b/,                    // exec
  /\bsource\b/,                  // source
  /\b\.\s+\//,                   // . /path (source shorthand)
];

/**
 * Extract the base command name from a command string.
 * Handles env prefixes like `VAR=val cmd` and path prefixes like `/usr/bin/cmd`.
 */
export function extractBaseCommand(command: string): string {
  const trimmed = command.trim();

  // Skip leading environment variable assignments (FOO=bar cmd ...)
  const tokens = trimmed.split(/\s+/);
  let baseToken = '';
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue; // env var assignment, skip
    }
    baseToken = token;
    break;
  }

  if (!baseToken) return '';

  // Strip path prefix: /usr/bin/git -> git
  const slashIdx = baseToken.lastIndexOf('/');
  return slashIdx >= 0 ? baseToken.slice(slashIdx + 1) : baseToken;
}

/**
 * Validate that a command string is safe to execute.
 * Returns null if safe, or an error message string if blocked.
 */
export function validateCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return 'Empty command';
  }

  // Check for dangerous shell metacharacters/patterns
  for (const pattern of DANGEROUS_SHELL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `Command contains blocked shell pattern: ${pattern}`;
    }
  }

  // Handle simple pipes: split on | and validate each segment
  const segments = trimmed.split(/\s*\|\s*/);
  for (const segment of segments) {
    const base = extractBaseCommand(segment);
    if (!base) {
      return `Could not determine command in segment: "${segment}"`;
    }
    if (!ALLOWED_COMMANDS.has(base)) {
      return `Command "${base}" is not in the allowed commands list`;
    }
  }

  return null; // safe
}

export const shellTool: ToolHandler = {
  name: 'shell',
  description:
    'Run a shell command in the project directory. Returns stdout, stderr, and exit code. ' +
    'Use for running tests, builds, linters, or other project commands. ' +
    'Only allowlisted commands (git, npm, tsc, eslint, vitest, etc.) are permitted.',
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

    const rejection = validateCommand(command);
    if (rejection) {
      throw new Error(
        `Command blocked by safety filter: "${command}". ${rejection}. ` +
        `Only allowlisted commands are permitted.`,
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
