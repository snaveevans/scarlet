import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent } from '../../src/agent/agent.js';
import { createCoreToolRegistry } from '../../src/tools/index.js';
import type { LLMClient, LLMRequest, LLMResponse } from '../../src/llm/client.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scarlet-integration-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('agent integration', () => {
  it('writes a file to disk via tool use', async () => {
    // Mock LLM that calls write_file then completes
    const client: LLMClient = {
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        const lastMessage = req.messages[req.messages.length - 1];

        // First call: write a file
        if (lastMessage?.role === 'user' && typeof lastMessage.content === 'string') {
          return {
            content: [
              { type: 'text', text: 'I will create a greeting module.' },
              {
                type: 'tool_use',
                id: 'tu_write',
                name: 'write_file',
                input: {
                  path: 'src/greet.ts',
                  content: 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
                },
              },
            ],
            stopReason: 'tool_use',
            usage: { inputTokens: 100, outputTokens: 80 },
            model: 'test-model',
          };
        }

        // Second call: after tool result, finish
        return {
          content: [{ type: 'text', text: 'Created src/greet.ts with a greet function.' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 150, outputTokens: 30 },
          model: 'test-model',
        };
      },
    };

    const tools = createCoreToolRegistry();

    const result = await runAgent({
      systemPrompt: 'You are a coding agent.',
      userPrompt: 'Create a greet function in src/greet.ts',
      tools,
      llmClient: client,
      projectRoot: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('write_file');
    expect(result.toolCalls[0]!.isError).toBe(false);

    // Verify the file actually exists on disk
    const content = readFileSync(join(tempDir, 'src/greet.ts'), 'utf-8');
    expect(content).toContain('export function greet');
    expect(content).toContain('Hello,');
  });

  it('reads then edits an existing file', async () => {
    // Pre-create a file
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(tempDir, 'src'));
    writeFileSync(
      join(tempDir, 'src/math.ts'),
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );

    let callCount = 0;

    const client: LLMClient = {
      complete: async (_req: LLMRequest): Promise<LLMResponse> => {
        callCount++;

        if (callCount === 1) {
          // Read the file first
          return {
            content: [
              { type: 'text', text: 'Let me read the file first.' },
              {
                type: 'tool_use',
                id: 'tu_read',
                name: 'read_file',
                input: { path: 'src/math.ts' },
              },
            ],
            stopReason: 'tool_use',
            usage: { inputTokens: 50, outputTokens: 40 },
            model: 'test',
          };
        }

        if (callCount === 2) {
          // Edit the file
          return {
            content: [
              { type: 'text', text: 'Now I will add a subtract function.' },
              {
                type: 'tool_use',
                id: 'tu_edit',
                name: 'edit_file',
                input: {
                  path: 'src/math.ts',
                  old_string: '}\n',
                  new_string: '}\n\nexport function subtract(a: number, b: number): number {\n  return a - b;\n}\n',
                },
              },
            ],
            stopReason: 'tool_use',
            usage: { inputTokens: 80, outputTokens: 60 },
            model: 'test',
          };
        }

        // Done
        return {
          content: [{ type: 'text', text: 'Added subtract function.' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 60, outputTokens: 20 },
          model: 'test',
        };
      },
    };

    const tools = createCoreToolRegistry();
    const result = await runAgent({
      systemPrompt: 'You are a coding agent.',
      userPrompt: 'Add a subtract function to src/math.ts',
      tools,
      llmClient: client,
      projectRoot: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.turns).toBe(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.name).toBe('read_file');
    expect(result.toolCalls[1]!.name).toBe('edit_file');

    // Verify file was modified
    const content = readFileSync(join(tempDir, 'src/math.ts'), 'utf-8');
    expect(content).toContain('export function add');
    expect(content).toContain('export function subtract');
    expect(content).toContain('return a - b');
  });
});
