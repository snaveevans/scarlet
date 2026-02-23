import { describe, it, expect } from 'vitest';
import { LayeredMemoryManager } from '../../src/memory/memory-manager.js';
import type { Skill, Pitfall } from '../../src/knowledge/types.js';

describe('LayeredMemoryManager', () => {
  it('includes always-present layers in every build', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 8000,
      projectRoot: '/tmp/project',
    });
    manager.setSystemContext('SYSTEM PROMPT');
    manager.setProjectContext('PROJECT CONTEXT');
    manager.setPhaseContext('code', 'T-001: Implement feature');

    const messages = manager.buildMessages('Implement task');
    expect(messages[0]?.content).toContain('SYSTEM PROMPT');
    expect(messages[1]?.content).toContain('PROJECT CONTEXT');
    expect(messages[1]?.content).toContain('Phase: code');
  });

  it('includes task-scoped layers when set', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 8000,
      projectRoot: '/tmp/project',
    });
    manager.setTaskPlan('Task plan body');
    manager.setFileContents([{ path: 'src/file.ts', content: 'export const a = 1;' }]);
    manager.setMatchedKnowledge([makeSkill('Skill A', 0.8)], [makePitfall('Pitfall A')]);
    manager.setPreviousError('Type error on previous attempt');

    const prompt = manager.buildMessages('Retry')[1]?.content ?? '';
    expect(prompt).toContain('Task plan body');
    expect(prompt).toContain('src/file.ts');
    expect(prompt).toContain('Skill A');
    expect(prompt).toContain('Pitfall A');
    expect(prompt).toContain('Type error on previous attempt');
  });

  it('grows session layer as tasks complete', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 8000,
      projectRoot: '/tmp/project',
    });
    manager.addCompletedTask('T-001', 'Create model', 'passed');
    manager.addCompletedTask('T-002', 'Add endpoint', 'failed');
    manager.addDecision('Use explicit validation');
    manager.addModifiedFile('src/model.ts');

    const context = manager.buildMessages('Continue')[1]?.content ?? '';
    expect(context).toContain('T-001 passed: Create model');
    expect(context).toContain('T-002 failed: Add endpoint');
    expect(context).toContain('Use explicit validation');
    expect(context).toContain('src/model.ts');
  });

  it('respects token budget and trims lower-priority layers first', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 140,
      projectRoot: '/tmp/project',
    });
    manager.setSystemContext('SYSTEM');
    manager.setProjectContext('PROJECT');
    manager.setTaskPlan('TASK PLAN');
    manager.setMatchedKnowledge(
      [
        makeSkill('High Confidence Skill', 0.95),
        makeSkill('Lower Confidence Skill', 0.45),
      ],
      [makePitfall('Low severity pitfall', 'low')],
    );

    for (let i = 1; i <= 12; i++) {
      manager.addCompletedTask(
        `T-${String(i).padStart(3, '0')}`,
        `Task ${i} ${'x'.repeat(80)}`,
        i % 2 === 0 ? 'passed' : 'failed',
      );
    }

    const context = manager.buildMessages('Continue')[1]?.content ?? '';
    expect(context).toContain('Summary:');
    expect(context).toContain('High Confidence Skill');
    expect(context).not.toContain('T-001 failed: Task 1');
  });

  it('truncates file contents when budget is tight', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 220,
      projectRoot: '/tmp/project',
    });
    const longFile = Array.from({ length: 180 }, (_, index) => `line ${index + 1}`).join('\n');
    manager.setTaskPlan('Edit large file');
    manager.setFileContents([{ path: 'src/large.ts', content: longFile }]);

    const context = manager.buildMessages('Edit file')[1]?.content ?? '';
    expect(context).toContain('src/large.ts');
    expect(context).toContain('... [truncated]');
  });

  it('builds messages in system, context, user order', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 8000,
      projectRoot: '/tmp/project',
    });
    const messages = manager.buildMessages('Final user prompt');

    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toContain('## System');
    expect(messages[1]?.content).toContain('## Context');
    expect(messages[2]?.content).toBe('Final user prompt');
  });

  it('clearTaskScope resets task-scoped layers between tasks', () => {
    const manager = new LayeredMemoryManager({
      maxTokens: 8000,
      projectRoot: '/tmp/project',
    });
    manager.setPhaseContext('code', 'T-001');
    manager.setTaskPlan('Task details');
    manager.setPreviousError('Old error');
    manager.setFileContents([{ path: 'src/a.ts', content: 'const a = 1;' }]);
    manager.setMatchedKnowledge([makeSkill('Reusable skill', 0.7)], [makePitfall('Pitfall')]);
    manager.addCompletedTask('T-000', 'Bootstrap', 'passed');

    manager.clearTaskScope();
    const context = manager.buildMessages('Next task')[1]?.content ?? '';
    expect(context).not.toContain('Task details');
    expect(context).not.toContain('Old error');
    expect(context).not.toContain('src/a.ts');
    expect(context).not.toContain('Reusable skill');
    expect(context).toContain('T-000 passed: Bootstrap');
  });
});

function makeSkill(name: string, confidence: number): Skill {
  return {
    id: `skill-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    description: `${name} description`,
    trigger: ['trigger'],
    content: `${name} content`,
    projectSpecific: true,
    confidence,
    usageCount: 1,
    lastUsed: new Date().toISOString(),
    createdFrom: 'phase11',
    tags: ['tag'],
    references: [],
  };
}

function makePitfall(
  description: string,
  severity: Pitfall['severity'] = 'medium',
): Pitfall {
  return {
    id: `pitfall-${description.toLowerCase().replace(/\s+/g, '-')}`,
    description,
    context: 'context',
    rootCause: 'root cause',
    avoidance: 'avoidance',
    severity,
    occurrences: 1,
    createdFrom: 'phase11',
    lastTriggered: new Date().toISOString(),
    tags: ['pitfall'],
    references: [],
  };
}
