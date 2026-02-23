/**
 * OpenAI-compatible Chat Completions provider.
 *
 * Supports OpenAI-style APIs exposing `/v1/chat/completions`.
 */

import type {
  ContentBlock,
  LLMClient,
  LLMRequest,
  LLMResponse,
  Message,
  StopReason,
  ToolDefinition,
} from './client.js';
import { LLMError } from './client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4.1';
const DEFAULT_MAX_TOKENS = 8192;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// OpenAI API types (subset we care about)
// ---------------------------------------------------------------------------

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIResponseMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAIToolCall[] | undefined;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIResponseMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | undefined;
}

interface OpenAIErrorResponse {
  error?: {
    message?: string;
  } | undefined;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

type OpenAIRequestMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function toOpenAITools(
  tools: ToolDefinition[] | undefined,
): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  if (!tools || tools.length === 0) return [];
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export function toOpenAIMessages(
  messages: Message[],
  system: string | undefined = undefined,
): OpenAIRequestMessage[] {
  const mapped: OpenAIRequestMessage[] = [];

  if (system) {
    mapped.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      mapped.push({ role: msg.role, content: msg.content });
      continue;
    }

    const textContent = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();

    const toolUses = msg.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
        b.type === 'tool_use',
    );
    const toolResults = msg.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_result' }> =>
        b.type === 'tool_result',
    );

    if (msg.role === 'assistant') {
      const assistantMessage: OpenAIRequestMessage = {
        role: 'assistant',
        content: textContent || (toolUses.length > 0 ? null : ''),
      };

      if (toolUses.length > 0) {
        assistantMessage.tool_calls = toolUses.map((toolUse) => ({
          id: toolUse.id,
          type: 'function',
          function: {
            name: toolUse.name,
            arguments: JSON.stringify(toolUse.input),
          },
        }));
      }

      mapped.push(assistantMessage);
      continue;
    }

    if (textContent || toolResults.length === 0) {
      mapped.push({ role: 'user', content: textContent });
    }

    for (const result of toolResults) {
      mapped.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content: result.content,
      });
    }
  }

  return mapped;
}

export function buildRequestBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model ?? DEFAULT_MODEL,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toOpenAIMessages(request.messages, request.system),
  };

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  const tools = toOpenAITools(request.tools);
  if (tools.length > 0) {
    body.tools = tools;
  }

  return body;
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

export function mapStopReason(raw: string | null): StopReason {
  if (raw === 'tool_calls' || raw === 'function_call') return 'tool_use';
  if (raw === 'length') return 'max_tokens';
  return 'end_turn';
}

export function mapContentBlocks(message: OpenAIResponseMessage): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (message.content) {
    blocks.push({ type: 'text', text: message.content });
  }

  for (const toolCall of message.tool_calls ?? []) {
    let parsedArguments: Record<string, unknown>;
    try {
      parsedArguments = toolCall.function.arguments
        ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>)
        : {};
    } catch {
      throw new LLMError(
        `OpenAI tool call "${toolCall.function.name}" returned invalid JSON arguments`,
        undefined,
        false,
      );
    }

    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parsedArguments,
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export interface OpenAIClientOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export class OpenAIClient implements LLMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: OpenAIClientOptions = {}) {
    const key = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new LLMError(
        'Missing API key: set OPENAI_API_KEY environment variable or pass apiKey option',
        undefined,
        false,
      );
    }
    this.apiKey = key;
    this.baseUrl = options.baseUrl ?? API_URL;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const body = buildRequestBody(request);
    let lastError: LLMError | undefined;

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ac = new AbortController();

    // Combine caller-provided signal with our timeout
    if (request.signal) {
      if (request.signal.aborted) {
        throw new LLMError('Request aborted', undefined, false);
      }
      request.signal.addEventListener('abort', () => ac.abort(request.signal!.reason), { once: true });
    }

    const timer = setTimeout(() => ac.abort('LLM request timed out'), timeoutMs);

    let retryAfterMs = 0;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
          const delay = Math.max(backoff, retryAfterMs);
          await sleep(delay);
          retryAfterMs = 0;
        }

        try {
          const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: ac.signal,
          });

          if (!response.ok) {
            const text = await response.text();
            let message = `OpenAI API error ${response.status}: ${text}`;

            try {
              const errorBody = JSON.parse(text) as OpenAIErrorResponse;
              if (errorBody.error?.message) {
                message = `OpenAI API error ${response.status}: ${errorBody.error.message}`;
              }
            } catch {
              // Use raw text payload
            }

            const retryable =
              response.status === 429 ||
              response.status === 500 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504;

            if (retryable && response.status === 429) {
              retryAfterMs = parseRetryAfter(response.headers?.get('retry-after') ?? null);
            }

            lastError = new LLMError(message, response.status, retryable);

            if (!retryable || attempt === MAX_RETRIES) {
              throw lastError;
            }
            continue;
          }

          const data = (await response.json()) as OpenAIResponse;
          const choice = data.choices[0];
          if (!choice) {
            throw new LLMError(
              'OpenAI API returned no choices',
              response.status,
              false,
            );
          }

          return {
            content: mapContentBlocks(choice.message),
            stopReason: mapStopReason(choice.finish_reason),
            usage: {
              inputTokens: data.usage?.prompt_tokens ?? 0,
              outputTokens: data.usage?.completion_tokens ?? 0,
            },
            model: data.model,
          };
        } catch (error) {
          if (error instanceof LLMError) {
            throw error;
          }

          // AbortError from timeout or caller signal
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new LLMError(
              `OpenAI request aborted: ${ac.signal.reason ?? 'timed out'}`,
              undefined,
              false,
            );
          }

          lastError = new LLMError(
            `Network error: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            true,
          );

          if (attempt === MAX_RETRIES) {
            throw lastError;
          }
        }
      }

      throw lastError ?? new LLMError('Unknown error', undefined, false);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a Retry-After header value into milliseconds.
 * Supports both seconds (integer) and HTTP-date formats.
 */
function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return 0;
}

export { parseRetryAfter };
