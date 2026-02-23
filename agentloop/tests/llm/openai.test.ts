import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAIClient,
  buildRequestBody,
  mapStopReason,
  mapContentBlocks,
  toOpenAIMessages,
} from '../../src/llm/openai.js';
import { LLMError } from '../../src/llm/client.js';
import type { LLMRequest, Message } from '../../src/llm/client.js';

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

const SIMPLE_REQUEST: LLMRequest = {
  messages: [{ role: 'user', content: 'Hi' }],
};

const VALID_RESPONSE = {
  id: 'chatcmpl_01',
  model: 'gpt-4.1',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: 'Hello!',
      },
    },
  ],
  usage: {
    prompt_tokens: 11,
    completion_tokens: 7,
  },
};

describe('OpenAIClient', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('throws when no API key is available', () => {
      vi.unstubAllEnvs();
      delete process.env.OPENAI_API_KEY;
      expect(() => new OpenAIClient()).toThrow(LLMError);
      expect(() => new OpenAIClient()).toThrow('Missing API key');
    });

    it('uses API key from env', () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();
      expect(client).toBeDefined();
    });
  });

  describe('complete', () => {
    it('sends request and parses response', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();
      const result = await client.complete(SIMPLE_REQUEST);

      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }]);
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
      expect(result.model).toBe('gpt-4.1');
    });

    it('sends expected auth header', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();

      await client.complete(SIMPLE_REQUEST);

      const fetchMock = vi.mocked(fetch);
      const [, options] = fetchMock.mock.calls[0]!;
      const headers = options?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer openai-key-123');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('uses custom base URL', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient({
        baseUrl: 'https://my-proxy/v1/chat/completions',
      });

      await client.complete(SIMPLE_REQUEST);
      expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
        'https://my-proxy/v1/chat/completions',
      );
    });

    it('passes system prompt and tools', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();

      await client.complete({
        ...SIMPLE_REQUEST,
        system: 'You are a coding agent.',
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            input_schema: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toBe('You are a coding agent.');
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
            },
          },
        },
      ]);
    });

    it('maps tool_calls responses', async () => {
      mockFetchResponse({
        ...VALID_RESPONSE,
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: 'Let me check that.',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"src/index.ts"}',
                  },
                },
              ],
            },
          },
        ],
      });

      const client = new OpenAIClient();
      const result = await client.complete(SIMPLE_REQUEST);

      expect(result.stopReason).toBe('tool_use');
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Let me check that.',
      });
      expect(result.content[1]).toEqual({
        type: 'tool_use',
        id: 'call_123',
        name: 'read_file',
        input: { path: 'src/index.ts' },
      });
    });

    it('throws LLMError on non-retryable API errors', async () => {
      mockFetchResponse(
        { error: { message: 'Invalid API key' } },
        401,
      );
      const client = new OpenAIClient();

      const error = await client.complete(SIMPLE_REQUEST).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).retryable).toBe(false);
      expect((error as LLMError).statusCode).toBe(401);
    });

    it('passes signal to fetch', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();

      await client.complete(SIMPLE_REQUEST);

      const fetchMock = vi.mocked(fetch);
      const [, options] = fetchMock.mock.calls[0]!;
      expect(options?.signal).toBeDefined();
      expect(options!.signal).toBeInstanceOf(AbortSignal);
    });

    it('throws LLMError when request times out', async () => {
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
      const client = new OpenAIClient();

      const error = await client.complete({ ...SIMPLE_REQUEST, timeoutMs: 50 }).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toMatch(/aborted/i);
      expect((error as LLMError).retryable).toBe(false);
    });

    it('throws LLMError when caller signal is already aborted', async () => {
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();
      const ac = new AbortController();
      ac.abort('cancelled');

      const error = await client.complete({ ...SIMPLE_REQUEST, signal: ac.signal }).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect((error as LLMError).message).toMatch(/aborted/i);
    });

    it('clears timeout on successful response', async () => {
      const clearSpy = vi.spyOn(global, 'clearTimeout');
      mockFetchResponse(VALID_RESPONSE);
      const client = new OpenAIClient();

      await client.complete(SIMPLE_REQUEST);

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});

describe('buildRequestBody', () => {
  it('uses defaults for model and max_tokens', () => {
    const body = buildRequestBody(SIMPLE_REQUEST);
    expect(body.model).toBe('gpt-4.1');
    expect(body.max_tokens).toBe(8192);
  });
});

describe('mapStopReason', () => {
  it('maps known finish reasons', () => {
    expect(mapStopReason('stop')).toBe('end_turn');
    expect(mapStopReason('tool_calls')).toBe('tool_use');
    expect(mapStopReason('length')).toBe('max_tokens');
  });
});

describe('mapContentBlocks', () => {
  it('throws on invalid tool argument JSON', () => {
    expect(() =>
      mapContentBlocks({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_bad',
            type: 'function',
            function: { name: 'read_file', arguments: '{bad json' },
          },
        ],
      }),
    ).toThrow(LLMError);
  });
});

describe('toOpenAIMessages', () => {
  it('maps assistant tool_use and user tool_result blocks', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading file...' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'read_file',
            input: { path: 'src/index.ts' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'file contents',
          },
        ],
      },
    ];

    const result = toOpenAIMessages(messages, 'System context');

    expect(result[0]).toEqual({
      role: 'system',
      content: 'System context',
    });
    expect(result[1]).toEqual({
      role: 'assistant',
      content: 'Reading file...',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"src/index.ts"}',
          },
        },
      ],
    });
    expect(result[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'file contents',
    });
  });
});
