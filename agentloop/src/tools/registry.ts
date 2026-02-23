/**
 * Tool registry — registers tool handlers and dispatches calls by name.
 */

import type { ToolDefinition } from '../llm/client.js';
import type { ToolHandler, ToolRegistry, ToolContext } from './types.js';

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();

  register(tool: ToolHandler): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  list(): ToolHandler[] {
    return Array.from(this.tools.values());
  }

  definitions(): ToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: "${name}"`);
    }
    return tool.execute(input, context);
  }
}
