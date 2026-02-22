/**
 * Comprehension module — Phase 0 of the agent pipeline.
 *
 * Re-exports the public API for running comprehension and converting
 * its output into executor-compatible tasks.
 */

export { runComprehension } from './comprehension.js';
export type { ComprehensionOptions, ComprehensionResult } from './comprehension.js';
export { planToTasks } from './plan-to-tasks.js';
export { savePlan } from './persist-plan.js';
export { prdToComprehensionInput, prdV2ToComprehensionInput } from './prd-bridge.js';
export type { ComprehensionInput, ImplementationPlan, CodebaseUnderstanding } from './types.js';
