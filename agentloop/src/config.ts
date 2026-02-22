import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentLoopConfig } from './types.js';
import type { AgentLoopConfig as AgentLoopConfigType } from './types.js';
import {
  DEFAULT_MODEL_ROUTING,
  mergeModelRouting,
  ModelRoutingInputSchema,
  type ModelRoutingInput,
} from './llm/routing.js';

/** Relative path (from project root) to the optional config file. */
const CONFIG_FILE = '.agentloop/config.json';

/** Built-in defaults. Lowest precedence — overridden by file then CLI. */
const DEFAULTS: AgentLoopConfigType = {
  agent: 'scarlet',
  maxAttempts: 3,
  autoCommit: true,
  skipFailedDeps: true,
  validationSteps: ['typecheck', 'lint', 'test', 'build'],
  contextBudget: 12000,
  taskTimeout: 600000,
  validationTimeout: 60000,
  dryRun: false,
  verbose: false,
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 8192,
    temperature: 0,
  },
  modelRouting: DEFAULT_MODEL_ROUTING,
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
  let fileConfig: Partial<Omit<AgentLoopConfigType, 'modelRouting'>> = {};
  let fileRoutingInput: ModelRoutingInput | undefined;

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(`Warning: Invalid config at ${configPath}, using defaults.`);
      } else {
        const data = { ...(parsed as Record<string, unknown>) };

        if ('modelRouting' in data) {
          const routingResult = ModelRoutingInputSchema.safeParse(data.modelRouting);
          if (routingResult.success) {
            fileRoutingInput = routingResult.data;
          } else {
            console.warn(
              `Warning: Invalid modelRouting in ${configPath}, using routing defaults.`,
            );
          }
          delete data.modelRouting;
        }

        const result = AgentLoopConfig
          .omit({ modelRouting: true })
          .partial()
          .safeParse(data);

        if (result.success) {
          // Cast needed: exactOptionalPropertyTypes and zod partial incompatibility
          fileConfig = result.data as Partial<Omit<AgentLoopConfigType, 'modelRouting'>>;
        } else {
          console.warn(
            `Warning: Invalid config at ${configPath}, using defaults.`,
          );
        }
      }
    } catch {
      console.warn(`Warning: Could not read config at ${configPath}.`);
    }
  }

  const { modelRouting: cliRoutingRaw, ...cliBaseOverrides } = cliOverrides;
  let cliRoutingInput: ModelRoutingInput | undefined;
  if (cliRoutingRaw) {
    const result = ModelRoutingInputSchema.safeParse(cliRoutingRaw);
    if (result.success) {
      cliRoutingInput = result.data;
    } else {
      console.warn('Warning: Invalid CLI modelRouting override, ignoring.');
    }
  }

  let modelRouting = mergeModelRouting(DEFAULTS.modelRouting, fileRoutingInput);
  modelRouting = mergeModelRouting(modelRouting, cliRoutingInput);

  const merged = {
    ...DEFAULTS,
    ...fileConfig,
    ...cliBaseOverrides,
    llm: {
      ...DEFAULTS.llm,
      ...fileConfig.llm,
      ...cliBaseOverrides.llm,
    },
    modelRouting,
  };

  return AgentLoopConfig.parse(merged);
}
