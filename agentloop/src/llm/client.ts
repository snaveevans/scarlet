/**
 * Provider-agnostic LLM client interface.
 *
 * All provider implementations (Anthropic, OpenAI, etc.) conform to this
 * interface so the rest of the system never couples to a specific vendor.
 */

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// Tool definitions (passed to the LLM so it knows what it can call)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export interface LLMRequest {
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface LLMClient {
  /** Send a completion request and return the model's response. */
  complete(request: LLMRequest): Promise<LLMResponse>;
}
