/**
 * Anthropic Messages API provider.
 *
 * Uses native `fetch` (Node 22+) — no SDK dependency. Handles rate-limit
 * retries with exponential backoff.
 */

import type {
  ContentBlock,
  LLMClient,
  LLMRequest,
  LLMResponse,
  StopReason,
} from './client.js';
import { LLMError } from './client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 8192;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// Anthropic API types (subset we care about)
// ---------------------------------------------------------------------------

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

function toAnthropicMessages(
  messages: LLMRequest['messages'],
): AnthropicMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    // Map our ContentBlock[] to Anthropic's format.
    // tool_result blocks go into user messages as-is in the Anthropic API.
    const blocks = msg.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      // tool_result — pass through (Anthropic accepts this in user messages)
      return {
        type: 'tool_result' as const,
        tool_use_id: block.tool_use_id,
        content: block.content,
        ...(block.is_error ? { is_error: block.is_error } : {}),
      };
    });

    return { role: msg.role, content: blocks as AnthropicContentBlock[] };
  });
}

function buildRequestBody(
  request: LLMRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model ?? DEFAULT_MODEL,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(request.messages),
  };

  if (request.system !== undefined) {
    body.system = request.system;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools;
  }

  return body;
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

function mapStopReason(raw: string): StopReason {
  if (raw === 'end_turn') return 'end_turn';
  if (raw === 'tool_use') return 'tool_use';
  if (raw === 'max_tokens') return 'max_tokens';
  // Default to end_turn for unknown reasons
  return 'end_turn';
}

function mapContentBlocks(blocks: AnthropicContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    return {
      type: 'tool_use' as const,
      id: block.id,
      name: block.name,
      input: block.input,
    };
  });
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export interface AnthropicClientOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

export class AnthropicClient implements LLMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: AnthropicClientOptions = {}) {
    const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new LLMError(
        'Missing API key: set ANTHROPIC_API_KEY environment variable or pass apiKey option',
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
              'x-api-key': this.apiKey,
              'anthropic-version': API_VERSION,
            },
            body: JSON.stringify(body),
            signal: ac.signal,
          });

          if (!response.ok) {
            const text = await response.text();
            let message = `Anthropic API error ${response.status}: ${text}`;

            try {
              const errorBody = JSON.parse(text) as AnthropicErrorResponse;
              if (errorBody.error?.message) {
                message = `Anthropic API error ${response.status}: ${errorBody.error.message}`;
              }
            } catch {
              // Use the raw text message
            }

            const retryable =
              response.status === 429 ||
              response.status === 500 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 529;

            if (retryable && response.status === 429) {
              retryAfterMs = parseRetryAfter(response.headers?.get('retry-after') ?? null);
            }

            lastError = new LLMError(message, response.status, retryable);

            if (!retryable || attempt === MAX_RETRIES) {
              throw lastError;
            }
            continue;
          }

          const data = (await response.json()) as AnthropicResponse;

          return {
            content: mapContentBlocks(data.content),
            stopReason: mapStopReason(data.stop_reason),
            usage: {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
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
              `Anthropic request aborted: ${ac.signal.reason ?? 'timed out'}`,
              undefined,
              false,
            );
          }

          // Network error
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

      // Should not reach here, but TypeScript needs it
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

// Exported for testing
export { buildRequestBody, mapStopReason, mapContentBlocks, toAnthropicMessages, parseRetryAfter };
