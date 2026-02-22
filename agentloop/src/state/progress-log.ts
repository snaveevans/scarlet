import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const STATE_DIR = '.agentloop';
const LOG_FILE = 'progress.log';

export class ProgressLog {
  private readonly logPath: string;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, STATE_DIR);
    mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, LOG_FILE);
  }

  write(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    appendFileSync(this.logPath, line, 'utf-8');
  }

  started(): void {
    this.write('=== AgentLoop started ===');
  }

  prdLoaded(taskCount: number, chainCount: number): void {
    this.write(
      `PRD loaded: ${taskCount} tasks, ${chainCount} dependency chains`,
    );
  }

  taskStarted(taskId: string, title: string): void {
    this.write(`[${taskId}] STARTED: ${title}`);
  }

  taskValidation(
    taskId: string,
    results: { name: string; passed: boolean }[],
  ): void {
    const summary = results
      .map((r) => `${r.name} ${r.passed ? '✓' : '✗'}`)
      .join(' | ');
    this.write(`[${taskId}] VALIDATE: ${summary}`);
  }

  taskPassed(
    taskId: string,
    attempt: number,
    maxAttempts: number,
    durationMs: number,
  ): void {
    const duration = formatDuration(durationMs);
    this.write(
      `[${taskId}] PASSED (attempt ${attempt}/${maxAttempts}, ${duration})`,
    );
  }

  taskRetry(taskId: string, attempt: number, maxAttempts: number, reason: string): void {
    this.write(
      `[${taskId}] RETRY (attempt ${attempt}/${maxAttempts}): ${reason}`,
    );
  }

  taskFailed(taskId: string, maxAttempts: number, reason: string): void {
    this.write(`[${taskId}] FAILED (max ${maxAttempts} attempts): ${reason}`);
  }

  taskSkipped(taskId: string, reason: string): void {
    this.write(`[${taskId}] SKIPPED: ${reason}`);
  }

  taskCommitted(taskId: string, sha: string, message: string): void {
    this.write(`[${taskId}] COMMITTED: ${sha.slice(0, 7)} "${message}"`);
  }

  summary(passed: number, failed: number, skipped: number, total: number): void {
    this.write(
      `=== Summary: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped ===`,
    );
  }

  error(message: string): void {
    this.write(`ERROR: ${message}`);
  }

  info(message: string): void {
    this.write(message);
  }
}

function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m${secs}s`;
}
