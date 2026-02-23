/**
 * Scarlet agent adapter — bridges the existing executor with the native
 * coding agent loop (Phase 3). Replaces the OpenCode CLI approach with
 * direct LLM calls and tool use.
 */

import type { AgentAdapter, AgentExecuteOptions } from './agent-adapter.js';
import type { AgentResult } from '../types.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/types.js';
import { runAgent } from '../agent/agent.js';
import { buildSystemPrompt } from '../agent/prompts.js';
import type { SystemPromptContext } from '../agent/prompts.js';

export interface ScarletAdapterOptions {
  llmClient: LLMClient;
  tools: ToolRegistry;
  /** Model to use for completions (overrides client default). */
  model?: string | undefined;
  /** Maximum agentic turns per task. Default: 30. */
  maxTurns?: number | undefined;
  /** Max tokens per LLM response. Default: 8192. */
  maxTokens?: number | undefined;
  /** Sampling temperature. Default: 0. */
  temperature?: number | undefined;
  /** Project conventions, tech stack, etc. for the system prompt. */
  promptContext?: SystemPromptContext | undefined;
}

export class ScarletAdapter implements AgentAdapter {
  name = 'scarlet';

  private readonly llmClient: LLMClient;
  private readonly tools: ToolRegistry;
  private readonly model: string | undefined;
  private readonly maxTurns: number;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly promptContext: SystemPromptContext;

  constructor(options: ScarletAdapterOptions) {
    this.llmClient = options.llmClient;
    this.tools = options.tools;
    this.model = options.model;
    this.maxTurns = options.maxTurns ?? 30;
    this.maxTokens = options.maxTokens ?? 8192;
    this.temperature = options.temperature ?? 0;
    this.promptContext = options.promptContext ?? {};
  }

  async execute(options: AgentExecuteOptions): Promise<AgentResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs;

    const systemPrompt = buildSystemPrompt(this.promptContext);

    // Create an AbortController so we can cancel the agent on timeout
    const controller = new AbortController();

    const agentPromise = runAgent({
      systemPrompt,
      userPrompt: options.prompt,
      tools: this.tools,
      llmClient: this.llmClient,
      projectRoot: options.projectRoot,
      model: options.model ?? this.model,
      maxTurns: this.maxTurns,
      maxTokens: options.maxTokens ?? this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      signal: controller.signal,
      onToolCall: options.verbose
        ? (name, input) => {
            console.log(`  [tool] ${name}(${JSON.stringify(input).slice(0, 100)})`);
          }
        : undefined,
    });

    let result;

    if (timeoutMs !== undefined && timeoutMs > 0) {
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          controller.abort();
          reject(new Error(`Agent timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      try {
        result = await Promise.race([agentPromise, timeout]);
      } catch (err) {
        return {
          success: false,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startTime,
        };
      } finally {
        if (timerId !== undefined) {
          clearTimeout(timerId);
        }
      }
    } else {
      result = await agentPromise;
    }

    return {
      success: result.success,
      stdout: result.finalMessage,
      stderr: '',
      durationMs: Date.now() - startTime,
    };
  }
}
