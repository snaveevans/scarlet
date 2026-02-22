import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentLoopConfig } from './types.js';
import type { AgentLoopConfig as AgentLoopConfigType } from './types.js';

/** Relative path (from project root) to the optional config file. */
const CONFIG_FILE = '.agentloop/config.json';

/** Built-in defaults. Lowest precedence — overridden by file then CLI. */
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

/**
 * Load and merge configuration from three layers (highest precedence wins):
 *
 * 1. **CLI flags** (`cliOverrides`)
 * 2. **Config file** (`.agentloop/config.json` in the project root)
 * 3. **Built-in defaults** ({@link DEFAULTS})
 *
 * Invalid config files emit a warning and are silently ignored.
 *
 * @param projectRoot - Absolute path to the target project.
 * @param cliOverrides - Partial config from parsed CLI flags.
 * @returns Fully resolved and Zod-validated configuration.
 */
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
