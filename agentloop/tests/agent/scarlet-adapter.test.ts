import { describe, it, expect, vi } from 'vitest';
import { ScarletAdapter } from '../../src/executor/scarlet-adapter.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../../src/llm/client.js';
import { DefaultToolRegistry } from '../../src/tools/registry.js';

function mockLLMClient(): LLMClient {
  return {
    complete: async (_req: LLMRequest): Promise<LLMResponse> => ({
      content: [{ type: 'text', text: 'Task completed successfully.' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 30 },
      model: 'test-model',
    }),
  };
}

function slowLLMClient(delayMs: number): LLMClient {
  return {
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 50, outputTokens: 30 },
        model: 'test-model',
      };
    },
  };
}

describe('ScarletAdapter', () => {
  it('has name "scarlet"', () => {
    const adapter = new ScarletAdapter({
      llmClient: mockLLMClient(),
      tools: new DefaultToolRegistry(),
    });
    expect(adapter.name).toBe('scarlet');
  });

  it('returns success when agent completes', async () => {
    const adapter = new ScarletAdapter({
      llmClient: mockLLMClient(),
      tools: new DefaultToolRegistry(),
    });

    const result = await adapter.execute({
      prompt: 'Write a function.',
      projectRoot: '/tmp/test',
      verbose: false,
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('Task completed');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes model config through', async () => {
    const completeSpy = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Done.' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: 'custom-model',
    } satisfies LLMResponse);

    const adapter = new ScarletAdapter({
      llmClient: { complete: completeSpy },
      tools: new DefaultToolRegistry(),
      model: 'claude-opus-4-6',
      maxTokens: 4096,
    });

    await adapter.execute({
      prompt: 'Test.',
      projectRoot: '/tmp/test',
      verbose: false,
    });

    const request = completeSpy.mock.calls[0]![0] as LLMRequest;
    expect(request.model).toBe('claude-opus-4-6');
    expect(request.maxTokens).toBe(4096);
  });

  it('logs tool calls in verbose mode', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const toolUseClient: LLMClient = {
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'test.ts' } },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 50, outputTokens: 50 },
          model: 'test',
        } satisfies LLMResponse)
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Done.' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 50, outputTokens: 20 },
          model: 'test',
        } satisfies LLMResponse),
    };

    const registry = new DefaultToolRegistry();
    registry.register({
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'file contents',
    });

    const adapter = new ScarletAdapter({
      llmClient: toolUseClient,
      tools: registry,
    });

    await adapter.execute({
      prompt: 'Read test.ts',
      projectRoot: '/tmp/test',
      verbose: true,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('read_file'),
    );

    consoleSpy.mockRestore();
  });

  it('returns timeout error when agent exceeds timeout', async () => {
    const adapter = new ScarletAdapter({
      llmClient: slowLLMClient(500),
      tools: new DefaultToolRegistry(),
    });

    const result = await adapter.execute({
      prompt: 'Slow task.',
      projectRoot: '/tmp/test',
      verbose: false,
      timeoutMs: 50,
    });

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('timed out');
  });

  it('clears timeout when agent completes before deadline', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const adapter = new ScarletAdapter({
      llmClient: mockLLMClient(),
      tools: new DefaultToolRegistry(),
    });

    const result = await adapter.execute({
      prompt: 'Fast task.',
      projectRoot: '/tmp/test',
      verbose: false,
      timeoutMs: 60_000,
    });

    expect(result.success).toBe(true);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
