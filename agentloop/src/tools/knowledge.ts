import { FileKnowledgeStore } from '../knowledge/file-store.js';
import type { ToolHandler, ToolContext } from './types.js';

const QUERY_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Keyword query describing what you need.',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (default 5).',
    },
  },
  required: ['query'],
};

export const querySkillsTool: ToolHandler = {
  name: 'query_skills',
  description: 'Search learned skills by keyword match over names, tags, and content.',
  inputSchema: QUERY_INPUT_SCHEMA,
  execute: async (input, context) => {
    const { query, limit } = parseQueryInput(input, context);
    const store = new FileKnowledgeStore(context.projectRoot);
    const results = store.querySkills(query, limit);
    return JSON.stringify(results, null, 2);
  },
};

export const queryPitfallsTool: ToolHandler = {
  name: 'query_pitfalls',
  description: 'Search known pitfalls by keyword match over context and root causes.',
  inputSchema: QUERY_INPUT_SCHEMA,
  execute: async (input, context) => {
    const { query, limit } = parseQueryInput(input, context);
    const store = new FileKnowledgeStore(context.projectRoot);
    const results = store.queryPitfalls(query, limit);
    return JSON.stringify(results, null, 2);
  },
};

function parseQueryInput(
  input: Record<string, unknown>,
  _context: ToolContext,
): { query: string; limit: number } {
  if (typeof input.query !== 'string') {
    throw new Error('query must be a string');
  }

  const query = input.query.trim();
  if (!query) {
    throw new Error('query cannot be empty');
  }

  const limitRaw = typeof input.limit === 'number' ? input.limit : 5;
  const limit = Math.max(1, Math.min(20, Math.floor(limitRaw)));

  return { query, limit };
}
