import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileKnowledgeStore } from '../../src/knowledge/file-store.js';
import { queryPitfallsTool, querySkillsTool } from '../../src/tools/knowledge.js';
import { createCoreToolRegistry } from '../../src/tools/index.js';
import type { ToolContext } from '../../src/tools/types.js';

describe('knowledge tools', () => {
  let tempDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'knowledge-tools-test-'));
    ctx = { projectRoot: tempDir };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('query_skills returns matching skills as JSON', async () => {
    const store = new FileKnowledgeStore(tempDir);
    store.saveSkill({
      name: 'Route checklist',
      description: 'Checklist for API route implementations',
      trigger: ['route', 'api'],
      content: 'Validate payload and return typed responses.',
      projectSpecific: true,
      confidence: 0.75,
      usageCount: 2,
      lastUsed: new Date().toISOString(),
      createdFrom: 'phase8',
      tags: ['backend'],
      references: [],
    });

    const output = await querySkillsTool.execute({ query: 'api route' }, ctx);
    expect(output).toContain('Route checklist');
  });

  it('query_pitfalls returns matching pitfalls as JSON', async () => {
    const store = new FileKnowledgeStore(tempDir);
    store.savePitfall({
      description: 'Forgot to await async call',
      context: 'validation pipeline',
      rootCause: 'missed await',
      avoidance: 'always return awaited promise in validator',
      severity: 'high',
      occurrences: 1,
      createdFrom: 'phase8',
      lastTriggered: new Date().toISOString(),
      tags: ['async'],
      references: [],
    });

    const output = await queryPitfallsTool.execute({ query: 'await' }, ctx);
    expect(output).toContain('Forgot to await async call');
  });

  it('registers knowledge tools in the core registry', () => {
    const registry = createCoreToolRegistry();
    const names = registry.definitions().map((def) => def.name);
    expect(names).toContain('query_skills');
    expect(names).toContain('query_pitfalls');
  });
});
