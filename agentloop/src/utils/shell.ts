import { spawn } from 'node:child_process';
import type { ShellResult } from '../types.js';

export interface ShellOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}

/**
 * Shell metacharacters that enable command chaining or subshell injection.
 * Shared between the shell tool allowlist and PRD command validation.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /;\s*/,        // command chaining via semicolon
  /&&/,          // logical AND chaining
  /\|\|/,        // logical OR chaining
  /\$\(/,        // command substitution $(...)
  /`/,           // backtick command substitution
  />\s*>/,       // append redirection >>
  />\s*[/~]/,    // redirect to absolute/home path
  /\beval\b/,    // eval
  /\bexec\b/,    // exec
  /\bsource\b/,  // source
  /\b\.\s+\//,   // . /path (source shorthand)
];

/**
 * Known-safe binaries that may appear in PRD validation commands.
 * More restrictive than the shell tool allowlist — only build/test tooling.
 */
const SAFE_PRD_COMMAND_PREFIXES: ReadonlySet<string> = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx',
  'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha',
  'node', 'python', 'python3',
  'make', 'cargo', 'gradle', 'mvn',
  'dotnet', 'go',
]);

/**
 * Validate that a PRD command string is safe for shell execution.
 * Rejects commands that contain injection metacharacters or start with
 * an unknown binary. Throws on invalid input.
 */
export function validatePrdCommand(command: string, fieldName: string): void {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error(`PRD ${fieldName} is empty`);
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `PRD ${fieldName} contains unsafe shell pattern: "${command}". ` +
        `Commands must not contain shell chaining operators (;, &&, ||, $(), backticks).`,
      );
    }
  }

  // Extract the base command (first non-env-var token, without path prefix)
  const tokens = trimmed.split(/\s+/);
  let baseToken = '';
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    baseToken = token;
    break;
  }

  if (!baseToken) {
    throw new Error(`PRD ${fieldName} has no command: "${command}"`);
  }

  const slashIdx = baseToken.lastIndexOf('/');
  const base = slashIdx >= 0 ? baseToken.slice(slashIdx + 1) : baseToken;

  if (!SAFE_PRD_COMMAND_PREFIXES.has(base)) {
    throw new Error(
      `PRD ${fieldName} uses disallowed command "${base}". ` +
      `Allowed: ${[...SAFE_PRD_COMMAND_PREFIXES].join(', ')}.`,
    );
  }
}

/**
 * Execute a shell command and capture stdout/stderr.
 * Returns structured result including exit code, output, and timeout status.
 */
export async function runShell(
  command: string,
  args: string[],
  options: ShellOptions = {},
): Promise<ShellResult> {
  const { cwd, timeoutMs = 60000, env, stdin } = options;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: stdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3000);
    }, timeoutMs);

    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - startTime,
        timedOut: false,
      });
    });
  });
}

/**
 * Run a shell command string through /bin/sh.
 */
export async function runShellCommand(
  command: string,
  options: ShellOptions = {},
): Promise<ShellResult> {
  return runShell('/bin/sh', ['-c', command], options);
}
