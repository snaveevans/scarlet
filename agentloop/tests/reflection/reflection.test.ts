import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileKnowledgeStore } from '../../src/knowledge/file-store.js';
import { runReflection } from '../../src/reflection/reflection.js';
import type { LLMClient } from '../../src/llm/client.js';
import type { Task } from '../../src/types.js';
import type { ImplementationPlan } from '../../src/comprehension/types.js';

describe('runReflection', () => {
  let tempDir: string;
  let store: FileKnowledgeStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'reflection-test-'));
    store = new FileKnowledgeStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts and saves a skill from successful work', async () => {
    const client = makeLLMClient({
      skills: [
        {
          name: 'Validation-first patching',
          description: 'Run focused tests after each surgical change.',
          trigger: ['tests', 'validation'],
          content: 'Execute targeted tests before full suite.',
          tags: ['quality'],
          references: ['tests/executor/executor.test.ts'],
        },
      ],
      pitfalls: [],
      toolCandidates: [],
      contextUpdates: ['Prefer focused test runs before full-suite validation.'],
    });

    const result = await runReflection({
      prdName: 'Phase 9',
      projectRoot: tempDir,
      tasks: [makeTask({ status: 'passed', attempts: 1 })],
      plan: makePlan(),
      diff: 'diff --git a/file.ts b/file.ts',
      progressLog: '[task] PASSED',
      llmClient: client,
      knowledgeStore: store,
    });

    expect(result.skillsExtracted).toHaveLength(1);
    expect(store.allSkills()).toHaveLength(1);
    expect(store.allSkills()[0]!.name).toContain('Validation-first');
  });

  it('extracts and saves a pitfall from retried work', async () => {
    const client = makeLLMClient({
      skills: [],
      pitfalls: [
        {
          description: 'Skipped import update after file move',
          context: 'refactor task with retries',
          rootCause: 'did not run search before edit',
          avoidance: 'use search_files for affected imports before renaming',
          severity: 'medium',
          tags: ['refactor'],
          references: ['src/refactor.ts'],
        },
      ],
      toolCandidates: [],
      contextUpdates: [],
    });

    const result = await runReflection({
      prdName: 'Phase 9',
      projectRoot: tempDir,
      tasks: [makeTask({ status: 'passed', attempts: 2 })],
      plan: makePlan(),
      diff: 'diff',
      progressLog: '[T-001] RETRY (attempt 1/3)',
      llmClient: client,
      knowledgeStore: store,
    });

    expect(result.pitfallsExtracted).toHaveLength(1);
    expect(store.allPitfalls()).toHaveLength(1);
    expect(store.allPitfalls()[0]!.occurrences).toBe(1);
  });

  it('deduplicates similar skills by merging confidence and usage', async () => {
    const existing = store.saveSkill({
      name: 'Validation-first patching',
      description: 'Run focused tests after each surgical change.',
      trigger: ['tests', 'validation'],
      content: 'Execute targeted tests before full suite.',
      projectSpecific: true,
      confidence: 0.5,
      usageCount: 1,
      lastUsed: new Date().toISOString(),
      createdFrom: 'phase8',
      tags: ['quality'],
      references: [],
    });

    const client = makeLLMClient({
      skills: [
        {
          name: 'Validation-first patching',
          description: 'Run focused tests after each surgical change.',
          trigger: ['validation'],
          content: 'Execute targeted tests before full suite.',
          tags: ['quality'],
          references: [],
        },
      ],
      pitfalls: [],
      toolCandidates: [],
      contextUpdates: [],
    });

    await runReflection({
      prdName: 'Phase 9',
      projectRoot: tempDir,
      tasks: [makeTask({ status: 'passed', attempts: 1 })],
      plan: makePlan(),
      diff: 'diff',
      progressLog: '[T-001] PASSED',
      llmClient: client,
      knowledgeStore: store,
    });

    const all = store.allSkills();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(existing.id);
    expect(all[0]!.confidence).toBeGreaterThan(0.5);
    expect(all[0]!.usageCount).toBe(2);
  });

  it('returns no pitfalls when none are extracted', async () => {
    const client = makeLLMClient({
      skills: [],
      pitfalls: [],
      toolCandidates: [],
      contextUpdates: [],
    });

    const result = await runReflection({
      prdName: 'Phase 9',
      projectRoot: tempDir,
      tasks: [makeTask({ status: 'passed', attempts: 1 })],
      plan: makePlan(),
      diff: 'diff',
      progressLog: '[T-001] PASSED',
      llmClient: client,
      knowledgeStore: store,
    });

    expect(result.pitfallsExtracted).toEqual([]);
  });

  it('regenerates .scarlet/context.md with reflection updates', async () => {
    const client = makeLLMClient({
      skills: [],
      pitfalls: [],
      toolCandidates: ['Automate checklist creation'],
      contextUpdates: ['Adopt scaffold-first flow for new modules.'],
    });

    const result = await runReflection({
      prdName: 'Phase 9',
      projectRoot: tempDir,
      tasks: [makeTask({ status: 'passed', attempts: 1 })],
      plan: makePlan(),
      diff: 'diff',
      progressLog: '[T-001] PASSED',
      llmClient: client,
      knowledgeStore: store,
    });

    const contextContent = readFileSync(result.contextPath, 'utf-8');
    expect(contextContent).toContain('## Reflection Updates');
    expect(contextContent).toContain('Adopt scaffold-first flow');
  });

  it('appends reflection updates when ## Team Notes marker is absent', async () => {
    // Pre-create a context.md without ## Team Notes
    const scarletDir = join(tempDir, '.scarlet');
    mkdirSync(scarletDir, { recursive: true });
    fsWriteFileSync(join(scarletDir, 'context.md'), '# Project Context\n\nSome content here.\n', 'utf-8');

    const client = makeLLMClient({
      skills: [],
      pitfalls: [],
      toolCandidates: [],
      contextUpdates: ['New update that should be appended.'],
    });

    const result = await runReflection({
      prdName: 'Phase 9',
      projectRoot: tempDir,
      tasks: [makeTask({ status: 'passed', attempts: 1 })],
      plan: makePlan(),
      diff: 'diff',
      progressLog: '[T-001] PASSED',
      llmClient: client,
      knowledgeStore: store,
    });

    const contextContent = readFileSync(result.contextPath, 'utf-8');
    expect(contextContent).toContain('## Reflection Updates');
    expect(contextContent).toContain('New update that should be appended.');
  });
});

function makeLLMClient(payload: unknown): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 80 },
      model: 'test-model',
    }),
  };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'T-001',
    title: 'Implement feature',
    depends: [],
    files: ['src/feature.ts'],
    description: 'Implement feature behavior',
    acceptanceCriteria: ['AC-1'],
    tests: ['tests/feature.test.ts'],
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

function makePlan(): ImplementationPlan {
  return {
    tasks: [
      {
        id: 'T-001',
        title: 'Implement feature',
        description: 'Implement feature behavior',
        satisfiesAC: ['AC-1'],
        dependsOn: [],
        filesToCreate: [],
        filesToModify: ['src/feature.ts'],
        tests: [{ file: 'tests/feature.test.ts', description: 'Validates AC-1' }],
        complexity: 'medium',
        risks: [],
      },
    ],
    acCoverage: [{ ac: 'AC-1', coveredByTasks: ['T-001'] }],
    decisions: [],
  };
}
