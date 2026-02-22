/**
 * Core agent loop — drives LLM → tool → LLM cycles until the model
 * signals completion or the turn limit is reached.
 */

import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  Message,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '../llm/client.js';
import type { ToolRegistry, ToolContext } from '../tools/types.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AgentOptions {
  /** System prompt describing the agent's role and constraints. */
  systemPrompt: string;
  /** Initial user message (task description, context, etc.). */
  userPrompt: string;
  /** Tool registry with registered tools. */
  tools: ToolRegistry;
  /** LLM client to use for completions. */
  llmClient: LLMClient;
  /** Absolute path to the project root (passed to tool context). */
  projectRoot: string;
  /** Model to use (overrides client default). */
  model?: string | undefined;
  /** Maximum agentic turns before stopping. Default: 30. */
  maxTurns?: number | undefined;
  /** Max tokens per LLM response. Default: 8192. */
  maxTokens?: number | undefined;
  /** Called when a tool is invoked (for logging/observability). */
  onToolCall?: ((name: string, input: unknown) => void) | undefined;
  /** Called after each LLM response (for logging/observability). */
  onResponse?: ((response: LLMResponse) => void) | undefined;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

export interface AgentLoopResult {
  /** Whether the agent completed successfully (ended with end_turn). */
  success: boolean;
  /** Number of LLM round-trips. */
  turns: number;
  /** Total input tokens across all turns. */
  totalInputTokens: number;
  /** Total output tokens across all turns. */
  totalOutputTokens: number;
  /** Record of every tool call made. */
  toolCalls: ToolCallRecord[];
  /** Text from the final assistant message (if any). */
  finalMessage: string;
  /** Total wall-clock duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_TOKENS = 8192;

export async function runAgent(options: AgentOptions): Promise<AgentLoopResult> {
  const {
    systemPrompt,
    userPrompt,
    tools,
    llmClient,
    projectRoot,
    model,
    maxTurns = DEFAULT_MAX_TURNS,
    maxTokens = DEFAULT_MAX_TOKENS,
    onToolCall,
    onResponse,
  } = options;

  const toolContext: ToolContext = { projectRoot };
  const toolDefs = tools.definitions();

  const messages: Message[] = [
    { role: 'user', content: userPrompt },
  ];

  const toolCallRecords: ToolCallRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalMessage = '';
  let turns = 0;
  const startTime = Date.now();

  while (turns < maxTurns) {
    turns++;

    const request: LLMRequest = {
      messages,
      system: systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      model,
      maxTokens,
      temperature: 0,
    };

    const response = await llmClient.complete(request);

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;

    onResponse?.(response);

    // Extract final text from response
    const textBlocks = response.content.filter(
      (b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text',
    );
    if (textBlocks.length > 0) {
      finalMessage = textBlocks.map((b) => b.text).join('\n');
    }

    // Model is done — no tool calls
    if (response.stopReason === 'end_turn') {
      // Add assistant message to history for completeness
      messages.push({ role: 'assistant', content: response.content });
      break;
    }

    // Model hit max_tokens — send a continuation prompt
    if (response.stopReason === 'max_tokens') {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Please continue.' });
      continue;
    }

    // Model wants to use tools
    if (response.stopReason === 'tool_use') {
      // Add the assistant's response (with tool_use blocks) to history
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );

      const toolResults: ToolResultBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        onToolCall?.(toolUse.name, toolUse.input);

        let output: string;
        let isError = false;

        try {
          output = await tools.execute(toolUse.name, toolUse.input, toolContext);
        } catch (err) {
          output = err instanceof Error ? err.message : String(err);
          isError = true;
        }

        toolCallRecords.push({
          name: toolUse.name,
          input: toolUse.input,
          output,
          isError,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: output,
          ...(isError ? { is_error: true } : {}),
        });
      }

      // Add tool results as a user message
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
  }

  return {
    success: turns < maxTurns,
    turns,
    totalInputTokens,
    totalOutputTokens,
    toolCalls: toolCallRecords,
    finalMessage,
    durationMs: Date.now() - startTime,
  };
}
