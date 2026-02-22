/**
 * Tool runtime types.
 *
 * Tools are capabilities the LLM can invoke during execution — reading files,
 * searching code, running shell commands, etc. Each tool conforms to the
 * {@link ToolHandler} interface and is registered in a {@link ToolRegistry}.
 */

import type { ToolDefinition } from '../llm/client.js';

// ---------------------------------------------------------------------------
// Context passed to every tool execution
// ---------------------------------------------------------------------------

export interface ToolContext {
  /** Absolute path to the project root. All relative paths resolve from here. */
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// Tool handler interface
// ---------------------------------------------------------------------------

export interface ToolHandler {
  /** Unique name matching the tool_use name from the LLM. */
  name: string;
  /** Human-readable description (sent to the LLM). */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Execute the tool and return a text result (or throw on error). */
  execute(input: Record<string, unknown>, context: ToolContext): Promise<string>;
}

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

export interface ToolRegistry {
  /** Register a tool handler. Throws if name already registered. */
  register(tool: ToolHandler): void;
  /** Get a tool by name, or undefined if not found. */
  get(name: string): ToolHandler | undefined;
  /** List all registered tool handlers. */
  list(): ToolHandler[];
  /** Generate ToolDefinition array for LLM API calls. */
  definitions(): ToolDefinition[];
  /** Execute a tool by name. Throws if tool not found. */
  execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Resolve a path relative to the project root and verify it doesn't escape.
 * Rejects paths that traverse above projectRoot or access .git internals.
 *
 * @returns The resolved absolute path.
 * @throws If the path escapes the project root or accesses .git.
 */
export function safePath(projectRoot: string, inputPath: string): string {
  const { resolve, relative } = require('node:path') as typeof import('node:path');
  const resolved = resolve(projectRoot, inputPath);
  const rel = relative(projectRoot, resolved);

  if (rel.startsWith('..') || rel.startsWith('/')) {
    throw new Error(
      `Path "${inputPath}" resolves outside the project root`,
    );
  }

  // Block .git internals but allow .gitignore, .github, etc.
  const segments = rel.split('/');
  if (segments[0] === '.git') {
    throw new Error(`Access to .git/ internals is not allowed`);
  }

  return resolved;
}
