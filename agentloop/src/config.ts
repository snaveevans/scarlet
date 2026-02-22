import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentLoopConfig } from './types.js';
import type { AgentLoopConfig as AgentLoopConfigType } from './types.js';

const CONFIG_FILE = '.agentloop/config.json';

const DEFAULTS: AgentLoopConfigType = {
  agent: 'opencode',
  maxAttempts: 3,
  autoCommit: true,
  skipFailedDeps: true,
  validationSteps: ['typecheck', 'lint', 'test', 'build'],
  contextBudget: 12000,
  taskTimeout: 600000,
  validationTimeout: 60000,
  dryRun: false,
  verbose: false,
};

export function loadConfig(
  projectRoot: string,
  cliOverrides: Partial<AgentLoopConfigType> = {},
): AgentLoopConfigType {
  const configPath = join(projectRoot, CONFIG_FILE);
  let fileConfig: Partial<AgentLoopConfigType> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const result = AgentLoopConfig.partial().safeParse(parsed);
      if (result.success) {
        // Cast needed: exactOptionalPropertyTypes and zod partial incompatibility
        fileConfig = result.data as Partial<AgentLoopConfigType>;
      } else {
        console.warn(
          `Warning: Invalid config at ${configPath}, using defaults.`,
        );
      }
    } catch {
      console.warn(`Warning: Could not read config at ${configPath}.`);
    }
  }

  const merged = {
    ...DEFAULTS,
    ...fileConfig,
    ...cliOverrides,
  };

  return AgentLoopConfig.parse(merged);
}
