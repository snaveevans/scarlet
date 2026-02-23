/**
 * Comprehension runner — orchestrates Phase 0.
 *
 * Steps: Explore → Decompose → Validate → (retry if invalid)
 */

import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/types.js';
import { runExplore } from './explore.js';
import { runDecompose } from './decompose.js';
import { validatePlan } from './validate-plan.js';
import type {
  ComprehensionInput,
  CodebaseUnderstanding,
  ImplementationPlan,
  Decision,
} from './types.js';

export interface ComprehensionOptions {
  input: ComprehensionInput;
  llmClient: LLMClient;
  tools: ToolRegistry;
  projectRoot: string;
  /** Model for exploration (should be strong reasoning). */
  exploreModel?: string | undefined;
  /** Max tokens for exploration requests. */
  exploreMaxTokens?: number | undefined;
  /** Temperature for exploration requests. */
  exploreTemperature?: number | undefined;
  /** Model for decomposition (should be strong reasoning). */
  decomposeModel?: string | undefined;
  /** Max tokens for decomposition requests. */
  decomposeMaxTokens?: number | undefined;
  /** Temperature for decomposition requests. */
  decomposeTemperature?: number | undefined;
}

export interface ComprehensionResult {
  understanding: CodebaseUnderstanding;
  plan: ImplementationPlan;
  decisions: Decision[];
}

/**
 * Run the full comprehension phase.
 *
 * 1. Explore the codebase to build understanding
 * 2. Decompose AC into implementation tasks
 * 3. Validate the plan (retry decompose if invalid, max 2 iterations)
 */
export async function runComprehension(
  options: ComprehensionOptions,
): Promise<ComprehensionResult> {
  const {
    input,
    llmClient,
    tools,
    projectRoot,
    exploreModel,
    exploreMaxTokens,
    exploreTemperature,
    decomposeModel,
    decomposeMaxTokens,
    decomposeTemperature,
  } = options;

  // Step 1: Explore
  const understanding = await runExplore({
    input,
    llmClient,
    tools,
    projectRoot,
    model: exploreModel,
    maxTokens: exploreMaxTokens,
    temperature: exploreTemperature,
  });

  // Step 2+3: Decompose + Validate (with retry)
  const maxValidationRetries = 2;
  let plan: ImplementationPlan | undefined;
  let previousValidationErrors: string[] | undefined;

  for (let attempt = 0; attempt <= maxValidationRetries; attempt++) {
    plan = await runDecompose({
      input,
      understanding,
      llmClient,
      projectRoot,
      model: decomposeModel,
      maxTokens: decomposeMaxTokens,
      temperature: decomposeTemperature,
      validationFeedback: previousValidationErrors,
    });

    const validation = validatePlan(plan, input);

    if (validation.valid) {
      break;
    }

    // Collect validation issues for feedback on next attempt
    const errors = validation.issues
      .filter((i) => i.severity === 'error')
      .map((i) => i.message);

    previousValidationErrors = errors;

    if (attempt === maxValidationRetries) {
      // Accept the plan with warnings — errors were logged
      console.warn(
        `Plan validation has issues after ${maxValidationRetries + 1} attempts:\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
      );
      break;
    }
  }

  if (!plan) {
    throw new Error('Comprehension failed: no plan produced');
  }

  return {
    understanding,
    plan,
    decisions: plan.decisions,
  };
}
