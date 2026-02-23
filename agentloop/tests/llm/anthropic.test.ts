import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnthropicClient,
  buildRequestBody,
  mapStopReason,
  mapContentBlocks,
  toAnthropicMessages,
} from '../../src/llm/anthropic.js';
import { LLMError } from '../../src/llm/client.js';
import type { LLMRequest, Message } from '../../src/llm/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

function mockFetchError(message: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error(message)),
  );
}

const VALID_RESPONSE = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello!' }],
  model: 'claude-sonnet-4-5-20250929',
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
};

const SIMPLE_REQUEST: LLMRequest = {
  messages: [{ role: 'user', content: 'Hi' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicClient', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('throws when no API key is available', () => {
      vi.unstubAllEnvs();
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => new AnthropicClient()).toThrow(LLMError);
      expect(() => new AnthropicClient()).toThrow('Missing API key');
    });

    it('uses API key from options over env', () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient({ apiKey: 'explicit-key' });
      expect(client).toBeDefined();
    });

    it('uses API key from env', () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();
      expect(client).toBeDefined();
    });
  });

  describe('complete', () => {
    it('sends correct request and parses response', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      const result = await client.complete(SIMPLE_REQUEST);

      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('sends correct headers', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      await client.complete(SIMPLE_REQUEST);

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0]!;
      const headers = options?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key-123');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('uses custom base URL', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient({ baseUrl: 'https://custom.api/v1/messages' });

      await client.complete(SIMPLE_REQUEST);

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://custom.api/v1/messages');
    });

    it('passes model and temperature from request', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      await client.complete({
        ...SIMPLE_REQUEST,
        model: 'claude-opus-4-6',
        temperature: 0.5,
        maxTokens: 4096,
      });

      const fetchMock = vi.mocked(fetch);
      const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
      expect(body.model).toBe('claude-opus-4-6');
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(4096);
    });

    it('passes system prompt when provided', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      await client.complete({
        ...SIMPLE_REQUEST,
        system: 'You are a helpful assistant.',
      });

      const fetchMock = vi.mocked(fetch);
      const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
      expect(body.system).toBe('You are a helpful assistant.');
    });

    it('passes tools when provided', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      const tools = [
        {
          name: 'read_file',
          description: 'Read a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ];

      await client.complete({ ...SIMPLE_REQUEST, tools });

      const fetchMock = vi.mocked(fetch);
      const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
      expect(body.tools).toEqual(tools);
    });

    it('omits tools when array is empty', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      await client.complete({ ...SIMPLE_REQUEST, tools: [] });

      const fetchMock = vi.mocked(fetch);
      const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
      expect(body.tools).toBeUndefined();
    });

    it('handles tool_use response', async () => {
      const toolResponse = {
        ...VALID_RESPONSE,
        content: [
          { type: 'text', text: 'Let me read that file.' },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'read_file',
            input: { path: 'src/index.ts' },
          },
        ],
        stop_reason: 'tool_use',
      };

      mockFetchResponse(toolResponse);
      const client = new AnthropicClient();
      const result = await client.complete(SIMPLE_REQUEST);

      expect(result.stopReason).toBe('tool_use');
      expect(result.content).toHaveLength(2);
      expect(result.content[0]!.type).toBe('text');
      expect(result.content[1]!.type).toBe('tool_use');

      const toolUse = result.content[1]!;
      if (toolUse.type === 'tool_use') {
        expect(toolUse.name).toBe('read_file');
        expect(toolUse.input).toEqual({ path: 'src/index.ts' });
      }
    });

    it('throws LLMError on 400 (non-retryable)', async () => {
      mockFetchResponse(
        { type: 'error', error: { type: 'invalid_request', message: 'Bad request' } },
        400,
      );
      const client = new AnthropicClient();

      await expect(client.complete(SIMPLE_REQUEST)).rejects.toThrow(LLMError);
      await expect(client.complete(SIMPLE_REQUEST)).rejects.toThrow('Bad request');
    });

    it('throws LLMError on 401 (non-retryable)', async () => {
      mockFetchResponse(
        { type: 'error', error: { type: 'authentication_error', message: 'Invalid key' } },
        401,
      );
      const client = new AnthropicClient();

      const error = await client.complete(SIMPLE_REQUEST).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).retryable).toBe(false);
      expect((error as LLMError).statusCode).toBe(401);
    });

    it('retries on 429 and eventually throws', async () => {
      // All attempts return 429
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          text: () => Promise.resolve('{"type":"error","error":{"type":"rate_limit","message":"Rate limited"}}'),
        }),
      );
      const client = new AnthropicClient();

      const error = await client.complete(SIMPLE_REQUEST).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).retryable).toBe(true);
      expect((error as LLMError).statusCode).toBe(429);

      // Should have retried (1 initial + 3 retries = 4 calls)
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
    }, 30000);

    it('retries on 529 (overloaded)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 529,
          text: () => Promise.resolve('overloaded'),
        }),
      );
      const client = new AnthropicClient();

      const error = await client.complete(SIMPLE_REQUEST).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).retryable).toBe(true);
    }, 30000);

    it('retries on network error', async () => {
      mockFetchError('ECONNREFUSED');
      const client = new AnthropicClient();

      const error = await client.complete(SIMPLE_REQUEST).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).retryable).toBe(true);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
    }, 30000);

    it('retries on 500 then succeeds', async () => {
      const failResponse = {
        ok: false,
        status: 500,
        text: () => Promise.resolve('internal error'),
      };

      const successResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve(VALID_RESPONSE),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce(failResponse)
          .mockResolvedValueOnce(successResponse),
      );
      const client = new AnthropicClient();

      const result = await client.complete(SIMPLE_REQUEST);
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    }, 30000);

    it('passes signal to fetch', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      await client.complete(SIMPLE_REQUEST);

      const fetchMock = vi.mocked(fetch);
      const [, options] = fetchMock.mock.calls[0]!;
      expect(options?.signal).toBeDefined();
      expect(options!.signal).toBeInstanceOf(AbortSignal);
    });

    it('throws LLMError when request times out', async () => {
      // fetch that never resolves (simulates hung connection)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }),
      );
      const client = new AnthropicClient();

      const error = await client.complete({ ...SIMPLE_REQUEST, timeoutMs: 50 }).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toMatch(/aborted/i);
      expect((error as LLMError).retryable).toBe(false);
    });

    it('throws LLMError when caller signal is already aborted', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();
      const ac = new AbortController();
      ac.abort('cancelled');

      const error = await client.complete({ ...SIMPLE_REQUEST, signal: ac.signal }).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toMatch(/aborted/i);
    });

    it('clears timeout on successful response', async () => {
      const clearSpy = vi.spyOn(global, 'clearTimeout');
      mockFetchResponse(VALID_RESPONSE);
      const client = new AnthropicClient();

      await client.complete(SIMPLE_REQUEST);

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for exported helpers
// ---------------------------------------------------------------------------

describe('buildRequestBody', () => {
  it('uses default model and max_tokens', () => {
    const body = buildRequestBody(SIMPLE_REQUEST);
    expect(body.model).toBe('claude-sonnet-4-5-20250929');
    expect(body.max_tokens).toBe(8192);
  });

  it('respects overrides', () => {
    const body = buildRequestBody({
      ...SIMPLE_REQUEST,
      model: 'claude-opus-4-6',
      maxTokens: 1024,
      temperature: 0.7,
      system: 'sys prompt',
    });
    expect(body.model).toBe('claude-opus-4-6');
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0.7);
    expect(body.system).toBe('sys prompt');
  });
});

describe('mapStopReason', () => {
  it('maps known reasons', () => {
    expect(mapStopReason('end_turn')).toBe('end_turn');
    expect(mapStopReason('tool_use')).toBe('tool_use');
    expect(mapStopReason('max_tokens')).toBe('max_tokens');
  });

  it('defaults unknown to end_turn', () => {
    expect(mapStopReason('something_new')).toBe('end_turn');
  });
});

describe('mapContentBlocks', () => {
  it('maps text blocks', () => {
    const result = mapContentBlocks([{ type: 'text', text: 'hi' }]);
    expect(result).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('maps tool_use blocks', () => {
    const result = mapContentBlocks([
      { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
    ]);
    expect(result).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
    ]);
  });
});

describe('toAnthropicMessages', () => {
  it('passes string content through', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('maps tool_result blocks', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'file contents here',
          },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result[0]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents here' },
    ]);
  });

  it('includes is_error when true', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'error occurred',
            is_error: true,
          },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    const block = (result[0]!.content as unknown[])[0] as Record<string, unknown>;
    expect(block.is_error).toBe(true);
  });
});
