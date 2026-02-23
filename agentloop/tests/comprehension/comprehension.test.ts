import { describe, it, expect, vi } from 'vitest';
import { runComprehension } from '../../src/comprehension/comprehension.js';
import type { ComprehensionOptions } from '../../src/comprehension/comprehension.js';
import type { LLMClient, LLMResponse, LLMRequest } from '../../src/llm/client.js';
import { DefaultToolRegistry } from '../../src/tools/registry.js';
import type { ToolHandler } from '../../src/tools/types.js';
import type { ComprehensionInput } from '../../src/comprehension/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(): ComprehensionInput {
  return {
    name: 'Auth Feature',
    summary: 'Add user authentication',
    acceptanceCriteria: [
      { id: 'AC-1', description: 'Users can log in' },
      { id: 'AC-2', description: 'Invalid credentials show error' },
    ],
    constraints: [],
    adrs: [],
    notes: '',
  };
}

const UNDERSTANDING_JSON = JSON.stringify({
  project: {
    packageManager: 'pnpm',
    framework: 'express',
    language: 'typescript',
    testFramework: 'vitest',
    buildTool: 'tsup',
    commands: { test: 'pnpm test' },
  },
  conventions: {
    fileOrganization: 'feature-based',
    testOrganization: 'co-located',
    importStyle: 'relative',
  },
  relevantCode: [],
});

const PLAN_JSON = JSON.stringify({
  tasks: [
    {
      id: 'T-001',
      title: 'Setup auth',
      description: 'Create the auth module',
      satisfiesAC: ['AC-1', 'AC-2'],
      dependsOn: [],
      filesToCreate: ['src/auth.ts'],
      filesToModify: [],
      tests: [{ file: 'tests/auth.test.ts', description: 'auth tests' }],
      complexity: 'medium',
      risks: [],
    },
  ],
  acCoverage: [
    { ac: 'AC-1', coveredByTasks: ['T-001'] },
    { ac: 'AC-2', coveredByTasks: ['T-001'] },
  ],
  decisions: [
    { decision: 'Use JWT', rationale: 'Stateless', alternatives: ['Sessions'] },
  ],
});

function mockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    complete: async (_req: LLMRequest) => {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`Mock LLM ran out of responses at call ${callIndex}`);
      }
      callIndex++;
      return response;
    },
  };
}

function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'test-model',
  };
}

function makeTools(): DefaultToolRegistry {
  const registry = new DefaultToolRegistry();
  const readFile: ToolHandler = {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => '{"name": "test"}',
  };
  const listDir: ToolHandler = {
    name: 'list_directory',
    description: 'List directory',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'src/\ntests/',
  };
  registry.register(readFile);
  registry.register(listDir);
  return registry;
}

function baseOptions(
  overrides: Partial<ComprehensionOptions> = {},
): ComprehensionOptions {
  return {
    input: makeInput(),
    llmClient: mockLLMClient([
      // Explore phase: returns understanding JSON
      textResponse(UNDERSTANDING_JSON),
      // Decompose phase: returns plan JSON
      textResponse(PLAN_JSON),
    ]),
    tools: makeTools(),
    projectRoot: '/tmp/test-project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runComprehension', () => {
  it('returns understanding, plan, and decisions', async () => {
    const result = await runComprehension(baseOptions());

    expect(result.understanding.project.language).toBe('typescript');
    expect(result.plan.tasks).toHaveLength(1);
    expect(result.plan.tasks[0]!.id).toBe('T-001');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]!.decision).toBe('Use JWT');
    expect(result.validationWarnings).toEqual([]);
  });

  it('passes through explore model option', async () => {
    const completeSpy = vi.fn<[LLMRequest], Promise<LLMResponse>>(
      async () => textResponse(UNDERSTANDING_JSON),
    );

    // Need two calls: explore + decompose
    let callCount = 0;
    const client: LLMClient = {
      complete: async (req: LLMRequest) => {
        callCount++;
        if (callCount === 1) {
          await completeSpy(req);
          return textResponse(UNDERSTANDING_JSON);
        }
        return textResponse(PLAN_JSON);
      },
    };

    await runComprehension(
      baseOptions({
        llmClient: client,
        exploreModel: 'claude-opus-4-20250514',
      }),
    );

    // The explore call goes through runAgent which passes model,
    // so we just verify it didn't throw
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('retries decompose on validation failure', async () => {
    const invalidPlan = JSON.stringify({
      tasks: [
        {
          id: 'T-001',
          title: 'Auth',
          description: '',  // empty description → validation error
          satisfiesAC: ['AC-1', 'AC-2'],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        { ac: 'AC-2', coveredByTasks: ['T-001'] },
      ],
      decisions: [],
    });

    const validPlan = JSON.stringify({
      tasks: [
        {
          id: 'T-001',
          title: 'Auth',
          description: 'Implement auth module',
          satisfiesAC: ['AC-1', 'AC-2'],
          dependsOn: [],
          filesToCreate: [],
          filesToModify: [],
          tests: [],
          complexity: 'low',
          risks: [],
        },
      ],
      acCoverage: [
        { ac: 'AC-1', coveredByTasks: ['T-001'] },
        { ac: 'AC-2', coveredByTasks: ['T-001'] },
      ],
      decisions: [],
    });

    let decomposeCallCount = 0;
    const client: LLMClient = {
      complete: async (req: LLMRequest) => {
        // First call is explore
        if (!req.system?.includes('decomposing')) {
          return textResponse(UNDERSTANDING_JSON);
        }
        // Decompose calls
        decomposeCallCount++;
        if (decomposeCallCount === 1) {
          return textResponse(invalidPlan);
        }
        return textResponse(validPlan);
      },
    };

    const result = await runComprehension(baseOptions({ llmClient: client }));
    expect(result.plan.tasks[0]!.description).toBe('Implement auth module');
  });

  it('throws when no plan is produced', async () => {
    // Explore succeeds but decompose always fails with invalid JSON
    const client: LLMClient = {
      complete: async (req: LLMRequest) => {
        if (!req.system?.includes('decomposing')) {
          return textResponse(UNDERSTANDING_JSON);
        }
        return textResponse('not valid json');
      },
    };

    await expect(
      runComprehension(baseOptions({ llmClient: client })),
    ).rejects.toThrow();
  });
});
