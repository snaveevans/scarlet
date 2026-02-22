import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { savePlan } from '../../src/comprehension/persist-plan.js';
import type { PlanFile } from '../../src/comprehension/persist-plan.js';
import type {
  CodebaseUnderstanding,
  ImplementationPlan,
} from '../../src/comprehension/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUnderstanding(): CodebaseUnderstanding {
  return {
    project: {
      packageManager: 'pnpm',
      framework: 'express',
      language: 'typescript',
      testFramework: 'vitest',
      buildTool: 'tsup',
      commands: {},
    },
    conventions: {
      fileOrganization: 'feature-based',
      testOrganization: 'co-located',
      importStyle: 'relative',
    },
    relevantCode: [],
  };
}

function makePlan(): ImplementationPlan {
  return {
    tasks: [
      {
        id: 'T-001',
        title: 'Auth module',
        description: 'Implement auth',
        satisfiesAC: ['AC-1'],
        dependsOn: [],
        filesToCreate: ['src/auth.ts'],
        filesToModify: [],
        tests: [],
        complexity: 'medium',
        risks: [],
      },
    ],
    acCoverage: [{ ac: 'AC-1', coveredByTasks: ['T-001'] }],
    decisions: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('savePlan', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'savePlan-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .scarlet/plans directory', () => {
    savePlan(tmpDir, 'My Feature', makeUnderstanding(), makePlan());
    expect(existsSync(join(tmpDir, '.scarlet', 'plans'))).toBe(true);
  });

  it('returns the file path', () => {
    const path = savePlan(tmpDir, 'Auth Feature', makeUnderstanding(), makePlan());
    expect(path).toContain('.scarlet/plans/auth-feature.json');
  });

  it('writes valid JSON', () => {
    const path = savePlan(tmpDir, 'Test', makeUnderstanding(), makePlan());
    const content = readFileSync(path, 'utf-8');
    const parsed: PlanFile = JSON.parse(content);
    expect(parsed.prdName).toBe('Test');
    expect(parsed.plan.tasks).toHaveLength(1);
    expect(parsed.understanding.project.language).toBe('typescript');
  });

  it('includes generatedAt timestamp', () => {
    const before = new Date().toISOString();
    const path = savePlan(tmpDir, 'Test', makeUnderstanding(), makePlan());
    const content = readFileSync(path, 'utf-8');
    const parsed: PlanFile = JSON.parse(content);
    expect(parsed.generatedAt >= before).toBe(true);
  });

  it('slugifies the name for the filename', () => {
    const path = savePlan(
      tmpDir,
      'My SUPER Feature!!!',
      makeUnderstanding(),
      makePlan(),
    );
    expect(path).toContain('my-super-feature.json');
  });

  it('truncates long names', () => {
    const longName = 'a'.repeat(100);
    const path = savePlan(tmpDir, longName, makeUnderstanding(), makePlan());
    const filename = path.split('/').pop()!;
    // slug is capped at 50 chars + .json = 55
    expect(filename.length).toBeLessThanOrEqual(55);
  });

  it('overwrites existing plan file', () => {
    const plan1 = makePlan();
    const plan2 = makePlan();
    plan2.tasks[0]!.title = 'Updated';

    savePlan(tmpDir, 'Same Name', makeUnderstanding(), plan1);
    const path = savePlan(tmpDir, 'Same Name', makeUnderstanding(), plan2);

    const content = readFileSync(path, 'utf-8');
    const parsed: PlanFile = JSON.parse(content);
    expect(parsed.plan.tasks[0]!.title).toBe('Updated');
  });
});
