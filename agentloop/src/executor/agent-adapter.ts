import type { AgentResult } from '../types.js';

export interface AgentExecuteOptions {
  prompt: string;
  projectRoot: string;
  verbose: boolean;
  timeoutMs?: number;
}

export interface AgentAdapter {
  /** Display name of the agent */
  name: string;

  /**
   * Execute a prompt through the coding agent.
   * Returns when the agent has finished its work.
   */
  execute(options: AgentExecuteOptions): Promise<AgentResult>;
}
