import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { FileKnowledgeStore } from '../../src/knowledge/file-store.js';
import type { AgentTool, Pitfall, Skill } from '../../src/knowledge/types.js';

describe('FileKnowledgeStore', () => {
  let tempDir: string;
  let store: FileKnowledgeStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'knowledge-store-test-'));
    store = new FileKnowledgeStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and retrieves a skill', () => {
    const saved = store.saveSkill(makeSkill({ name: 'Route scaffolding' }));
    expect(saved.id).toBe('skill-001');

    const all = store.allSkills();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Route scaffolding');
  });

  it('saves and retrieves a pitfall', () => {
    const saved = store.savePitfall(makePitfall({ description: 'Missing null guard' }));
    expect(saved.id).toBe('pitfall-001');

    const all = store.allPitfalls();
    expect(all).toHaveLength(1);
    expect(all[0]!.description).toContain('null guard');
  });

  it('queries relevant results with limit', () => {
    store.saveSkill(
      makeSkill({
        name: 'Express route pattern',
        trigger: ['express', 'route'],
        tags: ['api'],
      }),
    );
    store.saveSkill(
      makeSkill({
        name: 'React hook pattern',
        trigger: ['react', 'hook'],
        tags: ['frontend'],
      }),
    );

    const results = store.querySkills('express route', 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toContain('Express');
  });

  it('updates confidence and clamps between 0 and 1', () => {
    const skill = store.saveSkill(makeSkill({ confidence: 0.5 }));
    store.updateConfidence(skill.id, 0.3);
    expect(store.allSkills()[0]!.confidence).toBeCloseTo(0.8);

    store.updateConfidence(skill.id, 1);
    expect(store.allSkills()[0]!.confidence).toBe(1);
  });

  it('records usage with timestamp updates', () => {
    const skill = store.saveSkill(makeSkill({ usageCount: 0 }));
    const beforeSkill = skill.lastUsed;

    store.recordUsage(skill.id, 'skill');
    const updatedSkill = store.allSkills()[0]!;
    expect(updatedSkill.usageCount).toBe(1);
    expect(updatedSkill.lastUsed >= beforeSkill).toBe(true);

    const pitfall = store.savePitfall(makePitfall({ occurrences: 1 }));
    store.recordUsage(pitfall.id, 'pitfall');
    expect(store.allPitfalls()[0]!.occurrences).toBe(2);
  });

  it('archives entries and removes them from query results', () => {
    const skill = store.saveSkill(makeSkill({ name: 'Legacy migration pattern' }));
    expect(store.querySkills('migration')).toHaveLength(1);

    store.archive(skill.id, 'skill');
    expect(store.querySkills('migration')).toHaveLength(0);
  });

  it('prunes entries that reference missing files', () => {
    const staleSkill = store.saveSkill(
      makeSkill({
        name: 'Stale',
        references: ['src/deleted.ts'],
      }),
    );
    const activeSkill = store.saveSkill(
      makeSkill({
        name: 'Active',
        references: ['src/exists.ts'],
      }),
    );

    const result = store.prune(['src/exists.ts']);
    expect(result.archived).toBe(1);

    const remaining = store.allSkills();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(activeSkill.id);
    expect(remaining[0]!.id).not.toBe(staleSkill.id);
  });

  it('saves tools as json files and loads them', () => {
    const saved = store.saveTool(makeTool({ name: 'Scaffold route script' }));
    expect(saved.id).toBe('tool-001');

    const toolsPath = join(tempDir, '.scarlet', 'knowledge', 'tools', 'tool-001.json');
    expect(existsSync(toolsPath)).toBe(true);
    expect(store.allTools()).toHaveLength(1);
  });

  it('backs up corrupt json and starts fresh', () => {
    const knowledgeDir = join(tempDir, '.scarlet', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    writeFileSync(join(knowledgeDir, 'skills.json'), '{ invalid json', 'utf-8');

    const freshStore = new FileKnowledgeStore(tempDir);
    expect(freshStore.allSkills()).toEqual([]);

    const backups = readdirSync(knowledgeDir).filter((name) =>
      name.startsWith('skills.json.bak.'),
    );
    expect(backups.length).toBeGreaterThanOrEqual(1);

    freshStore.saveSkill(makeSkill({ name: 'Recovered' }));
    const savedContent = readFileSync(join(knowledgeDir, 'skills.json'), 'utf-8');
    expect(savedContent).toContain('Recovered');
  });
});

function makeSkill(overrides: Partial<Omit<Skill, 'id'>> = {}): Omit<Skill, 'id'> {
  const now = new Date().toISOString();
  return {
    name: 'Default skill',
    description: 'Use helper functions for deterministic behavior',
    trigger: ['helper'],
    content: 'Prefer shared utilities and avoid duplicate logic.',
    projectSpecific: true,
    confidence: 0.7,
    usageCount: 1,
    lastUsed: now,
    createdFrom: 'PRD v2',
    tags: ['pattern'],
    references: [],
    ...overrides,
  };
}

function makePitfall(
  overrides: Partial<Omit<Pitfall, 'id'>> = {},
): Omit<Pitfall, 'id'> {
  const now = new Date().toISOString();
  return {
    description: 'Default pitfall',
    context: 'Implementing async flow',
    rootCause: 'Skipped error handling',
    avoidance: 'Always bubble explicit errors',
    severity: 'medium',
    occurrences: 1,
    createdFrom: 'PRD v2',
    lastTriggered: now,
    tags: ['errors'],
    references: [],
    ...overrides,
  };
}

function makeTool(
  overrides: Partial<Omit<AgentTool, 'id'>> = {},
): Omit<AgentTool, 'id'> {
  const now = new Date().toISOString();
  return {
    name: 'Default tool',
    description: 'Generate file scaffolding',
    type: 'script',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    content: 'echo scaffold',
    usageCount: 0,
    createdFrom: 'PRD v2',
    lastUsed: now,
    references: [],
    ...overrides,
  };
}
