import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentExecuteOptions } from './agent-adapter.js';
import type { AgentResult } from '../types.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode';

  async execute(options: AgentExecuteOptions): Promise<AgentResult> {
    const { prompt, projectRoot, verbose, timeoutMs = 600000 } = options;
    const startTime = Date.now();

    // Write prompt to a temp file as fallback for CLIs that don't accept stdin
    const tmpFile = join(tmpdir(), `agentloop-prompt-${randomUUID()}.txt`);
    writeFileSync(tmpFile, prompt, 'utf-8');

    try {
      return await this.runWithPipe(
        prompt,
        projectRoot,
        verbose,
        timeoutMs,
        startTime,
      );
    } catch {
      // Fall back to temp file approach
      return await this.runWithFile(
        tmpFile,
        projectRoot,
        verbose,
        timeoutMs,
        startTime,
      );
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private runWithPipe(
    prompt: string,
    cwd: string,
    verbose: boolean,
    timeoutMs: number,
    startTime: number,
  ): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'opencode',
        ['--non-interactive'],
        {
          cwd,
          stdio: ['pipe', verbose ? 'inherit' : 'pipe', verbose ? 'inherit' : 'pipe'],
          env: process.env,
        },
      );

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      if (!verbose) {
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, timeoutMs);

      child.stdin?.write(prompt);
      child.stdin?.end();

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: !timedOut && code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private runWithFile(
    promptFile: string,
    cwd: string,
    verbose: boolean,
    timeoutMs: number,
    startTime: number,
  ): Promise<AgentResult> {
    return new Promise((resolve) => {
      const child = spawn(
        'opencode',
        ['--file', promptFile],
        {
          cwd,
          stdio: ['ignore', verbose ? 'inherit' : 'pipe', verbose ? 'inherit' : 'pipe'],
          env: process.env,
        },
      );

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      if (!verbose) {
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: !timedOut && code === 0,
          stdout: stdout.trim(),
          stderr: timedOut
            ? `Timed out after ${timeoutMs}ms\n${stderr}`
            : stderr.trim(),
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
