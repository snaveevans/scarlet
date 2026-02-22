/**
 * Step 1: Explore — builds a mental model of the codebase.
 *
 * Uses the agent loop with read-only tools to discover project structure,
 * conventions, and code relevant to the PRD's subject matter.
 */

import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/types.js';
import { DefaultToolRegistry } from '../tools/registry.js';
import { runAgent } from '../agent/agent.js';
import { CodebaseUnderstandingSchema } from './types.js';
import type { CodebaseUnderstanding, ComprehensionInput } from './types.js';

// Read-only tool names — exploration should not modify files
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'find_files',
]);

/**
 * Create a read-only subset of the tool registry for exploration.
 */
function createReadOnlyRegistry(full: ToolRegistry): ToolRegistry {
  const registry = new DefaultToolRegistry();
  for (const tool of full.list()) {
    if (READ_ONLY_TOOLS.has(tool.name)) {
      registry.register(tool);
    }
  }
  return registry;
}

export interface ExploreOptions {
  input: ComprehensionInput;
  llmClient: LLMClient;
  tools: ToolRegistry;
  projectRoot: string;
  model?: string | undefined;
}

const EXPLORE_SYSTEM_PROMPT = `You are analyzing a codebase to prepare for implementing a feature.

Your goal is to build a structured understanding of the project. Use the available tools to:
1. Read the project root (package.json, tsconfig.json, etc.) to understand the tech stack
2. Explore the directory structure to understand file organization
3. Search for patterns relevant to the feature being implemented
4. Read key files to understand existing conventions

When you are done exploring, respond with a JSON object (and nothing else) matching this schema:
{
  "project": {
    "packageManager": "npm|pnpm|yarn|bun",
    "framework": "react-router|next|express|none|...",
    "language": "typescript|javascript",
    "testFramework": "vitest|jest|mocha|node:test|...",
    "buildTool": "vite|tsup|tsc|webpack|...",
    "commands": {
      "typecheck": "command or omit if not applicable",
      "lint": "command or omit",
      "test": "command or omit",
      "build": "command or omit"
    }
  },
  "conventions": {
    "fileOrganization": "description of how files are organized",
    "testOrganization": "co-located|__tests__|tests/|...",
    "importStyle": "path aliases|relative|barrel exports|..."
  },
  "relevantCode": [
    {
      "path": "relative/path/to/file.ts",
      "purpose": "why this file matters for the feature",
      "keyExports": ["functionName", "TypeName"]
    }
  ]
}

Respond ONLY with the JSON object. No markdown fences, no explanation.`;

/**
 * Run the explore step: analyze the codebase and return a structured understanding.
 */
export async function runExplore(options: ExploreOptions): Promise<CodebaseUnderstanding> {
  const { input, llmClient, tools, projectRoot, model } = options;

  const readOnlyTools = createReadOnlyRegistry(tools);

  const userPrompt = `The feature to implement is: "${input.name}"

Summary: ${input.summary}

Acceptance Criteria:
${input.acceptanceCriteria.map((ac) => `- ${ac.id}: ${ac.description}`).join('\n')}

${input.notes ? `Notes:\n${input.notes}` : ''}

Explore the codebase to understand its structure, conventions, and any existing code relevant to this feature.`;

  const result = await runAgent({
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    userPrompt,
    tools: readOnlyTools,
    llmClient,
    projectRoot,
    model,
    maxTurns: 20,
    maxTokens: 8192,
  });

  return parseExploreOutput(result.finalMessage);
}

/**
 * Parse the LLM's JSON output into a validated CodebaseUnderstanding.
 */
export function parseExploreOutput(output: string): CodebaseUnderstanding {
  // Strip markdown fences if the LLM wrapped it
  let cleaned = output.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Explore step returned invalid JSON. Output:\n${output.slice(0, 500)}`,
    );
  }

  const result = CodebaseUnderstandingSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Explore output failed validation:\n${issues}`);
  }

  return result.data;
}
