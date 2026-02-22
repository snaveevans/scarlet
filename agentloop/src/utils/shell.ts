import { spawn } from 'node:child_process';
import type { ShellResult } from '../types.js';

export interface ShellOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
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
