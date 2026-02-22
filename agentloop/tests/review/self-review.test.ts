import { describe, it, expect, vi } from 'vitest';
import {
  parseReviewResult,
  reviewFixesToTasks,
  runSelfReview,
} from '../../src/review/self-review.js';
import type { LLMClient } from '../../src/llm/client.js';

function makeLLMClientWithText(text: string): LLMClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: 'test-model',
    }),
  };
}

describe('runSelfReview', () => {
  it('parses approved review responses', async () => {
    const client = makeLLMClientWithText(
      JSON.stringify({
        approved: true,
        acStatus: [{ ac: 'AC-1: Works', satisfied: true, evidence: 'src/a.ts' }],
        scopeCreep: [],
        codeSmells: [],
        fixList: [],
      }),
    );

    const result = await runSelfReview({
      prdContent: 'PRD content',
      acceptanceCriteria: ['AC-1: Works'],
      diff: 'diff',
      llmClient: client,
    });

    expect(result.approved).toBe(true);
    expect(result.acStatus[0]!.satisfied).toBe(true);
  });

  it('parses missing AC and scope creep findings', async () => {
    const client = makeLLMClientWithText(
      JSON.stringify({
        approved: false,
        acStatus: [{ ac: 'AC-2: Missing', satisfied: false, evidence: 'No matching diff' }],
        scopeCreep: ['Added unrelated debug endpoint'],
        codeSmells: ['TODO comment left behind'],
        fixList: [
          {
            file: 'src/api/debug.ts',
            issue: 'Remove unrelated debug endpoint',
            severity: 'must-fix',
          },
        ],
      }),
    );

    const result = await runSelfReview({
      prdContent: 'PRD content',
      acceptanceCriteria: ['AC-2: Missing'],
      diff: 'diff',
      llmClient: client,
    });

    expect(result.approved).toBe(false);
    expect(result.scopeCreep).toContain('Added unrelated debug endpoint');
    expect(result.codeSmells).toContain('TODO comment left behind');
    expect(result.fixList[0]!.severity).toBe('must-fix');
  });

  it('rejects invalid JSON output', () => {
    expect(() => parseReviewResult('not json')).toThrow('invalid JSON');
  });

  it('converts fix list into executable tasks', () => {
    const tasks = reviewFixesToTasks(
      {
        approved: false,
        acStatus: [],
        scopeCreep: [],
        codeSmells: [],
        fixList: [
          {
            file: 'src/foo.ts',
            issue: 'Remove dead code',
            severity: 'should-fix',
          },
        ],
      },
      1,
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('R1-001');
    expect(tasks[0]!.files).toEqual(['src/foo.ts']);
    expect(tasks[0]!.description).toContain('Remove dead code');
  });
});
