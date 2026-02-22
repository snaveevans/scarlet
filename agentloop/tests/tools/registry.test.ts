import { describe, it, expect } from 'vitest';
import { DefaultToolRegistry } from '../../src/tools/registry.js';
import type { ToolHandler, ToolContext } from '../../src/tools/types.js';

function makeTool(name: string): ToolHandler {
  return {
    name,
    description: `A test tool called ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `executed ${name}`,
  };
}

const ctx: ToolContext = { projectRoot: '/tmp/test' };

describe('DefaultToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new DefaultToolRegistry();
    const tool = makeTool('test_tool');
    registry.register(tool);

    expect(registry.get('test_tool')).toBe(tool);
  });

  it('returns undefined for unregistered tool', () => {
    const registry = new DefaultToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('throws when registering duplicate name', () => {
    const registry = new DefaultToolRegistry();
    registry.register(makeTool('dup'));
    expect(() => registry.register(makeTool('dup'))).toThrow('already registered');
  });

  it('lists all registered tools', () => {
    const registry = new DefaultToolRegistry();
    registry.register(makeTool('a'));
    registry.register(makeTool('b'));

    const tools = registry.list();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('generates ToolDefinition array', () => {
    const registry = new DefaultToolRegistry();
    registry.register(makeTool('my_tool'));

    const defs = registry.definitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      name: 'my_tool',
      description: 'A test tool called my_tool',
      input_schema: { type: 'object', properties: {} },
    });
  });

  it('executes a registered tool', async () => {
    const registry = new DefaultToolRegistry();
    registry.register(makeTool('exec_test'));

    const result = await registry.execute('exec_test', {}, ctx);
    expect(result).toBe('executed exec_test');
  });

  it('throws when executing unknown tool', async () => {
    const registry = new DefaultToolRegistry();
    await expect(registry.execute('nope', {}, ctx)).rejects.toThrow(
      'Unknown tool: "nope"',
    );
  });
});
