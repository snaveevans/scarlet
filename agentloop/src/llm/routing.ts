import { z } from 'zod';

export const TaskComplexitySchema = z.enum(['low', 'medium', 'high']);
export type TaskComplexity = z.infer<typeof TaskComplexitySchema>;

export const ModelConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ModelRoutingOverrideSchema = z.object({
  phase: z.string(),
  complexity: TaskComplexitySchema.optional(),
  model: ModelConfigSchema,
});

export type ModelRoutingOverride = z.infer<typeof ModelRoutingOverrideSchema>;

export const ModelRoutingSchema = z.object({
  default: ModelConfigSchema,
  overrides: z.array(ModelRoutingOverrideSchema).default([]),
});

export type ModelRouting = z.infer<typeof ModelRoutingSchema>;

const PartialModelConfigSchema = ModelConfigSchema.partial();

export const ModelRoutingInputSchema = z.object({
  default: PartialModelConfigSchema.optional(),
  overrides: z
    .array(
      z.object({
        phase: z.string(),
        complexity: TaskComplexitySchema.optional(),
        model: PartialModelConfigSchema.default({}),
      }),
    )
    .optional(),
});

export type ModelRoutingInput = z.infer<typeof ModelRoutingInputSchema>;

const DEFAULT_PROVIDER = 'anthropic';
const OPUS_MODEL = 'claude-opus-4-6';
const SONNET_MODEL = 'claude-sonnet-4-5-20250929';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  default: {
    provider: DEFAULT_PROVIDER,
    model: SONNET_MODEL,
    maxTokens: 8192,
    temperature: 0,
  },
  overrides: [
    {
      phase: 'explore',
      model: {
        provider: DEFAULT_PROVIDER,
        model: OPUS_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'decompose',
      model: {
        provider: DEFAULT_PROVIDER,
        model: OPUS_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'validate-plan',
      model: {
        provider: DEFAULT_PROVIDER,
        model: SONNET_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'scaffold',
      model: {
        provider: DEFAULT_PROVIDER,
        model: HAIKU_MODEL,
        maxTokens: 4096,
        temperature: 0,
      },
    },
    {
      phase: 'code',
      complexity: 'low',
      model: {
        provider: DEFAULT_PROVIDER,
        model: HAIKU_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'code',
      complexity: 'medium',
      model: {
        provider: DEFAULT_PROVIDER,
        model: SONNET_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'code',
      complexity: 'high',
      model: {
        provider: DEFAULT_PROVIDER,
        model: OPUS_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'assess',
      model: {
        provider: DEFAULT_PROVIDER,
        model: SONNET_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'review',
      model: {
        provider: DEFAULT_PROVIDER,
        model: OPUS_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
    {
      phase: 'reflect',
      model: {
        provider: DEFAULT_PROVIDER,
        model: OPUS_MODEL,
        maxTokens: 8192,
        temperature: 0,
      },
    },
  ],
};

export function resolveModel(
  routing: ModelRouting | undefined,
  phase: string,
  complexity?: TaskComplexity,
): ModelConfig {
  const active = routing ?? DEFAULT_MODEL_ROUTING;

  if (complexity) {
    const exact = active.overrides.find(
      (override) =>
        override.phase === phase && override.complexity === complexity,
    );
    if (exact) return exact.model;
  }

  const phaseOnly = active.overrides.find(
    (override) => override.phase === phase && override.complexity === undefined,
  );
  if (phaseOnly) return phaseOnly.model;

  const mediumMatch = active.overrides.find(
    (override) => override.phase === phase && override.complexity === 'medium',
  );
  if (mediumMatch) return mediumMatch.model;

  const firstPhaseMatch = active.overrides.find(
    (override) => override.phase === phase,
  );
  if (firstPhaseMatch) return firstPhaseMatch.model;

  return active.default;
}

export function mergeModelRouting(
  base: ModelRouting,
  override?: ModelRoutingInput,
): ModelRouting {
  if (!override) {
    return base;
  }

  const mergedDefault = {
    ...base.default,
    ...(override.default ?? {}),
  };

  const mergedOverrides = new Map<string, ModelRoutingOverride>();
  for (const entry of base.overrides) {
    mergedOverrides.set(overrideKey(entry.phase, entry.complexity), entry);
  }

  for (const entry of override.overrides ?? []) {
    const key = overrideKey(entry.phase, entry.complexity);
    const existing = mergedOverrides.get(key);
    const baseModel = existing?.model ?? mergedDefault;
    mergedOverrides.set(key, {
      phase: entry.phase,
      ...(entry.complexity ? { complexity: entry.complexity } : {}),
      model: ModelConfigSchema.parse({
        ...baseModel,
        ...entry.model,
      }),
    });
  }

  return ModelRoutingSchema.parse({
    default: mergedDefault,
    overrides: Array.from(mergedOverrides.values()),
  });
}

function overrideKey(phase: string, complexity: TaskComplexity | undefined): string {
  return `${phase}::${complexity ?? '*'}`;
}
