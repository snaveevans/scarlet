import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { LoopState } from '../types.js';
import type { LoopState as LoopStateType, Task } from '../types.js';

const STATE_DIR = '.agentloop';
const STATE_FILE = 'state.json';

export class StateManager {
  private readonly statePath: string;
  private readonly stateDir: string;
  private state: LoopStateType;

  constructor(projectRoot: string) {
    this.stateDir = join(projectRoot, STATE_DIR);
    this.statePath = join(this.stateDir, STATE_FILE);
    this.state = this.loadOrInit();
  }

  private loadOrInit(): LoopStateType {
    if (!existsSync(this.statePath)) {
      return this.emptyState();
    }

    try {
      const raw = readFileSync(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return LoopState.parse(parsed);
    } catch (err) {
      // Back up corrupted state and start fresh
      const backupPath = `${this.statePath}.bak.${Date.now()}`;
      try {
        renameSync(this.statePath, backupPath);
        console.warn(
          `State file corrupted, backed up to ${backupPath}`,
        );
      } catch {
        // If backup fails, ignore
      }
      return this.emptyState();
    }
  }

  private emptyState(): LoopStateType {
    const now = new Date().toISOString();
    return {
      prdFile: '',
      startedAt: now,
      lastUpdated: now,
      currentTaskId: null,
      tasks: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, pending: 0 },
    };
  }

  getState(): LoopStateType {
    return this.state;
  }

  initializeRun(prdFile: string, tasks: Task[]): void {
    const now = new Date().toISOString();
    // Deep-copy tasks so mutations don't affect the caller's array reference
    const tasksCopy = tasks.map((t) => ({ ...t }));
    this.state = {
      prdFile,
      startedAt: now,
      lastUpdated: now,
      currentTaskId: null,
      tasks: tasksCopy,
      summary: this.computeSummary(tasksCopy),
    };
    this.persist();
  }

  updateTask(taskId: string, updates: Partial<Task>): void {
    const idx = this.state.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`Task ${taskId} not found in state`);
    }
    this.state.tasks[idx] = { ...this.state.tasks[idx]!, ...updates };
    this.state.lastUpdated = new Date().toISOString();
    this.state.summary = this.computeSummary(this.state.tasks);
    this.persist();
  }

  setCurrentTask(taskId: string | null): void {
    this.state.currentTaskId = taskId;
    this.state.lastUpdated = new Date().toISOString();
    this.persist();
  }

  getTask(taskId: string): Task | undefined {
    return this.state.tasks.find((t) => t.id === taskId);
  }

  hasExistingRun(): boolean {
    return existsSync(this.statePath) && this.state.tasks.length > 0;
  }

  private computeSummary(
    tasks: Task[],
  ): LoopStateType['summary'] {
    return {
      total: tasks.length,
      passed: tasks.filter((t) => t.status === 'passed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      skipped: tasks.filter((t) => t.status === 'skipped').length,
      pending: tasks.filter(
        (t) => t.status === 'pending' || t.status === 'in_progress',
      ).length,
    };
  }

  persist(): void {
    mkdirSync(this.stateDir, { recursive: true });
    const tmpPath = `${this.statePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
    renameSync(tmpPath, this.statePath);
  }
}
