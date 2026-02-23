import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../../src/agent/agent.js';
import type { AgentOptions } from '../../src/agent/agent.js';
import type { LLMClient, LLMResponse, LLMRequest } from '../../src/llm/client.js';
import { DefaultToolRegistry } from '../../src/tools/registry.js';
import type { ToolHandler } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function toolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = 'toolu_01',
): LLMResponse {
  return {
    content: [
      { type: 'text', text: `Calling ${toolName}` },
      { type: 'tool_use', id: toolCallId, name: toolName, input },
    ],
    stopReason: 'tool_use',
    usage: { inputTokens: 100, outputTokens: 80 },
    model: 'test-model',
  };
}

function maxTokensResponse(text: string): LLMResponse {
  return {
    content: [{ type: 'text', text }],
    stopReason: 'max_tokens',
    usage: { inputTokens: 100, outputTokens: 200 },
    model: 'test-model',
  };
}

function makeTool(name: string, handler?: (input: Record<string, unknown>) => Promise<string>): ToolHandler {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: handler ?? (async () => `result from ${name}`),
  };
}

function makeRegistry(...tools: ToolHandler[]): DefaultToolRegistry {
  const registry = new DefaultToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}

function baseOptions(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    systemPrompt: 'You are a test agent.',
    userPrompt: 'Do something.',
    tools: makeRegistry(),
    llmClient: mockLLMClient([textResponse('Done.')]),
    projectRoot: '/tmp/test-project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgent', () => {
  it('completes immediately when LLM returns end_turn', async () => {
    const result = await runAgent(baseOptions());

    expect(result.success).toBe(true);
    expect(result.turns).toBe(1);
    expect(result.finalMessage).toBe('Done.');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.totalInputTokens).toBe(100);
    expect(result.totalOutputTokens).toBe(50);
  });

  it('executes tool calls and continues', async () => {
    const echoTool = makeTool('echo', async (input) => {
      return `echoed: ${JSON.stringify(input)}`;
    });

    const client = mockLLMClient([
      toolUseResponse('echo', { msg: 'hello' }),
      textResponse('All done.'),
    ]);

    const result = await runAgent(
      baseOptions({
        tools: makeRegistry(echoTool),
        llmClient: client,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('echo');
    expect(result.toolCalls[0]!.output).toContain('echoed');
    expect(result.toolCalls[0]!.isError).toBe(false);
    expect(result.finalMessage).toBe('All done.');
  });

  it('handles tool errors gracefully', async () => {
    const failTool = makeTool('fail_tool', async () => {
      throw new Error('Tool broke');
    });

    const client = mockLLMClient([
      toolUseResponse('fail_tool', {}),
      textResponse('Handled the error.'),
    ]);

    const result = await runAgent(
      baseOptions({
        tools: makeRegistry(failTool),
        llmClient: client,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.isError).toBe(true);
    expect(result.toolCalls[0]!.output).toBe('Tool broke');
  });

  it('handles unknown tool name as error', async () => {
    const client = mockLLMClient([
      toolUseResponse('nonexistent_tool', {}),
      textResponse('Ok.'),
    ]);

    const result = await runAgent(
      baseOptions({ llmClient: client }),
    );

    expect(result.success).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.isError).toBe(true);
    expect(result.toolCalls[0]!.output).toContain('Unknown tool');
  });

  it('respects maxTurns limit', async () => {
    // LLM always asks for tools — never ends
    const infiniteTool = makeTool('loop');
    const responses: LLMResponse[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push(toolUseResponse('loop', {}, `toolu_${i}`));
    }

    const client = mockLLMClient(responses);

    const result = await runAgent(
      baseOptions({
        tools: makeRegistry(infiniteTool),
        llmClient: client,
        maxTurns: 5,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.turns).toBe(5);
  });

  it('handles max_tokens by sending continuation', async () => {
    const client = mockLLMClient([
      maxTokensResponse('partial output...'),
      textResponse('...completed.'),
    ]);

    const result = await runAgent(baseOptions({ llmClient: client }));

    expect(result.success).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.finalMessage).toBe('...completed.');
  });

  it('tracks cumulative token usage', async () => {
    const tool = makeTool('counter');
    const client = mockLLMClient([
      toolUseResponse('counter', {}),
      toolUseResponse('counter', {}, 'toolu_02'),
      textResponse('Done.'),
    ]);

    const result = await runAgent(
      baseOptions({
        tools: makeRegistry(tool),
        llmClient: client,
      }),
    );

    expect(result.turns).toBe(3);
    // 3 responses × 100 input tokens = 300
    expect(result.totalInputTokens).toBe(300);
    // 2 tool responses × 80 + 1 text × 50 = 210
    expect(result.totalOutputTokens).toBe(210);
  });

  it('calls onToolCall callback', async () => {
    const onToolCall = vi.fn();
    const tool = makeTool('tracked');
    const client = mockLLMClient([
      toolUseResponse('tracked', { key: 'val' }),
      textResponse('Done.'),
    ]);

    await runAgent(
      baseOptions({
        tools: makeRegistry(tool),
        llmClient: client,
        onToolCall,
      }),
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith('tracked', { key: 'val' });
  });

  it('calls onResponse callback', async () => {
    const onResponse = vi.fn();
    const client = mockLLMClient([textResponse('Hi.')]);

    await runAgent(baseOptions({ llmClient: client, onResponse }));

    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onResponse.mock.calls[0]![0].stopReason).toBe('end_turn');
  });

  it('handles multiple tool calls in a single response', async () => {
    const toolA = makeTool('tool_a');
    const toolB = makeTool('tool_b');

    const multiToolResponse: LLMResponse = {
      content: [
        { type: 'tool_use', id: 'tu_a', name: 'tool_a', input: {} },
        { type: 'tool_use', id: 'tu_b', name: 'tool_b', input: {} },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 100 },
      model: 'test-model',
    };

    const client = mockLLMClient([multiToolResponse, textResponse('Done.')]);

    const result = await runAgent(
      baseOptions({
        tools: makeRegistry(toolA, toolB),
        llmClient: client,
      }),
    );

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.name).toBe('tool_a');
    expect(result.toolCalls[1]!.name).toBe('tool_b');
  });

  it('measures duration', async () => {
    const client = mockLLMClient([textResponse('Fast.')]);
    const result = await runAgent(baseOptions({ llmClient: client }));

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it('returns early when abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runAgent(
      baseOptions({ signal: controller.signal }),
    );

    expect(result.success).toBe(false);
    expect(result.turns).toBe(0);
    expect(result.finalMessage).toBe('Agent aborted via signal.');
  });

  it('stops at next turn when signal is aborted mid-execution', async () => {
    const controller = new AbortController();
    const tool = makeTool('abort_trigger', async () => {
      controller.abort();
      return 'triggered abort';
    });

    const client = mockLLMClient([
      toolUseResponse('abort_trigger', {}),
      // Agent should never reach this response
      textResponse('Should not reach.'),
    ]);

    const result = await runAgent(
      baseOptions({
        tools: makeRegistry(tool),
        llmClient: client,
        signal: controller.signal,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.turns).toBe(1);
    expect(result.finalMessage).toBe('Agent aborted via signal.');
  });
});
