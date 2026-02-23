/**
 * Step 2: Decompose — breaks acceptance criteria into implementation tasks.
 *
 * Single LLM call (no tool use). Takes AC + codebase understanding and
 * produces a structured implementation plan validated with Zod.
 */

import type { LLMClient } from '../llm/client.js';
import { LayeredMemoryManager, messagesToPrompt } from '../memory/index.js';
import { ImplementationPlanSchema } from './types.js';
import type {
  CodebaseUnderstanding,
  ComprehensionInput,
  ImplementationPlan,
} from './types.js';

export interface DecomposeOptions {
  input: ComprehensionInput;
  understanding: CodebaseUnderstanding;
  llmClient: LLMClient;
  projectRoot?: string | undefined;
  model?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  /** Max retries on malformed LLM output. Default: 2. */
  maxRetries?: number | undefined;
  /** Validation errors from a previous decompose attempt to feed back to the LLM. */
  validationFeedback?: string[] | undefined;
}

const DECOMPOSE_SYSTEM_PROMPT = `You are a software architect decomposing a feature into implementation tasks.

Given a feature description with acceptance criteria and a codebase analysis, produce an implementation plan as a JSON object.

Rules:
- Each task should be a focused, independently testable unit of work
- Tasks must be ordered by dependency (infrastructure before features)
- Every acceptance criterion must be covered by at least one task
- Record any decisions you make that weren't specified in the requirements
- File paths should be relative to the project root
- Follow the project's existing conventions for file organization and naming
- Task IDs should be T-001, T-002, etc.

Respond with a JSON object (no markdown fences, no explanation) matching this schema:
{
  "tasks": [
    {
      "id": "T-001",
      "title": "Short descriptive title",
      "description": "Detailed implementation instructions",
      "satisfiesAC": ["AC-1"],
      "dependsOn": [],
      "filesToCreate": ["src/path/to/new-file.ts"],
      "filesToModify": ["src/path/to/existing.ts"],
      "tests": [{"file": "tests/path.test.ts", "description": "what to test"}],
      "complexity": "low|medium|high",
      "risks": ["potential issues"]
    }
  ],
  "acCoverage": [
    {"ac": "AC-1: description", "coveredByTasks": ["T-001"]}
  ],
  "decisions": [
    {
      "decision": "What was decided",
      "rationale": "Why",
      "alternatives": ["What else was considered"]
    }
  ]
}`;

/**
 * Decompose acceptance criteria into an implementation plan.
 */
export async function runDecompose(
  options: DecomposeOptions,
): Promise<ImplementationPlan> {
  const {
    input,
    understanding,
    llmClient,
    projectRoot,
    model,
    maxTokens,
    temperature,
    maxRetries = 2,
    validationFeedback,
  } = options;

  const basePrompt = buildDecomposePrompt(input, understanding);
  const memory = new LayeredMemoryManager({
    maxTokens: maxTokens ?? 8192,
    projectRoot: projectRoot ?? process.cwd(),
  });
  memory.setPhaseContext('decompose', input.name);
  memory.setTaskPlan(basePrompt);
  const userPrompt = messagesToPrompt(
    memory.buildMessages(
      'Decompose the feature into executable tasks and return JSON only.',
    ),
  );

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const feedbackParts: string[] = [];

    if (attempt === 0 && validationFeedback && validationFeedback.length > 0) {
      feedbackParts.push(
        `Your previous plan had structural validation issues:\n${validationFeedback.map((issue) => `- ${issue}`).join('\n')}\n\nPlease fix these issues in the new plan.`,
      );
    } else if (attempt > 0 && lastError) {
      feedbackParts.push(
        `Your previous response was not valid JSON or failed validation: ${lastError.message}. Please try again, responding with ONLY the JSON object.`,
      );
    }

    const messages = feedbackParts.length === 0
      ? [{ role: 'user' as const, content: userPrompt }]
      : [
          { role: 'user' as const, content: userPrompt },
          { role: 'user' as const, content: feedbackParts.join('\n\n') },
        ];

    const response = await llmClient.complete({
      messages,
      system: DECOMPOSE_SYSTEM_PROMPT,
      model,
      maxTokens: maxTokens ?? 8192,
      temperature: temperature ?? 0,
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => {
        if (b.type === 'text') return b.text;
        return '';
      })
      .join('');

    try {
      return parseDecomposeOutput(text);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) {
        throw new Error(
          `Decompose failed after ${maxRetries + 1} attempts: ${lastError.message}`,
        );
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw lastError ?? new Error('Decompose failed');
}

/**
 * Parse and validate the LLM's decompose output.
 */
export function parseDecomposeOutput(output: string): ImplementationPlan {
  let cleaned = output.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Decompose returned invalid JSON. Output:\n${output.slice(0, 500)}`,
    );
  }

  const result = ImplementationPlanSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Decompose output failed validation:\n${issues}`);
  }

  return result.data;
}

function buildDecomposePrompt(
  input: ComprehensionInput,
  understanding: CodebaseUnderstanding,
): string {
  const sections: string[] = [];

  sections.push(`# Feature: ${input.name}\n\n${input.summary}`);

  sections.push(
    `## Acceptance Criteria\n${input.acceptanceCriteria.map((ac) => `- ${ac.id}: ${ac.description}`).join('\n')}`,
  );

  if (input.constraints.length > 0) {
    sections.push(
      `## Constraints\n${input.constraints.map((c) => `- ${c}`).join('\n')}`,
    );
  }

  if (input.adrs.length > 0) {
    sections.push(
      `## Architectural Decisions\n${input.adrs.map((adr) => `### ${adr.id}: ${adr.title}\n${adr.decision}\nRationale: ${adr.rationale}`).join('\n\n')}`,
    );
  }

  if (input.notes) {
    sections.push(`## Notes\n${input.notes}`);
  }

  sections.push(
    `## Codebase Analysis\n\n` +
    `**Project:** ${understanding.project.language}, ${understanding.project.framework}, ` +
    `${understanding.project.packageManager}\n` +
    `**Test framework:** ${understanding.project.testFramework}\n` +
    `**Build tool:** ${understanding.project.buildTool}\n` +
    `**File organization:** ${understanding.conventions.fileOrganization}\n` +
    `**Test organization:** ${understanding.conventions.testOrganization}\n` +
    `**Import style:** ${understanding.conventions.importStyle}`,
  );

  if (understanding.relevantCode.length > 0) {
    sections.push(
      `## Relevant Existing Code\n${understanding.relevantCode.map((rc) => `- \`${rc.path}\`: ${rc.purpose} (exports: ${rc.keyExports.join(', ')})`).join('\n')}`,
    );
  }

  return sections.join('\n\n');
}

export { buildDecomposePrompt };
