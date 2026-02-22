/**
 * Plan persistence — saves the implementation plan to .scarlet/plans/.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ImplementationPlan, CodebaseUnderstanding } from './types.js';

export interface PlanFile {
  generatedAt: string;
  prdName: string;
  understanding: CodebaseUnderstanding;
  plan: ImplementationPlan;
}

/**
 * Save the comprehension result to .scarlet/plans/<name>.json.
 *
 * @returns The path to the saved plan file.
 */
export function savePlan(
  projectRoot: string,
  prdName: string,
  understanding: CodebaseUnderstanding,
  plan: ImplementationPlan,
): string {
  const plansDir = join(projectRoot, '.scarlet', 'plans');
  mkdirSync(plansDir, { recursive: true });

  const slug = prdName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  const filename = `${slug}.json`;
  const filePath = join(plansDir, filename);

  const planFile: PlanFile = {
    generatedAt: new Date().toISOString(),
    prdName,
    understanding,
    plan,
  };

  writeFileSync(filePath, JSON.stringify(planFile, null, 2), 'utf-8');

  return filePath;
}
