/**
 * System prompt construction for the coding agent.
 */

export interface SystemPromptContext {
  /** Project conventions from .scarlet/context.md (optional, future). */
  projectConventions?: string | undefined;
  /** Tech stack description from PRD meta. */
  techStack?: string | undefined;
  /** Test framework name. */
  testFramework?: string | undefined;
}

/**
 * Build the system prompt for the coding agent.
 *
 * This tells the LLM its role, available tools, constraints, and
 * any project-specific conventions.
 */
export function buildSystemPrompt(context: SystemPromptContext = {}): string {
  const sections: string[] = [];

  sections.push(`You are a coding agent. Your job is to modify files in a project to satisfy the task you are given.

Use the tools available to you to:
1. Read and understand existing code before making changes
2. Write, edit, or create files to implement the required changes
3. Search the codebase for relevant patterns and references
4. Run commands to verify your changes (tests, typecheck, etc.)

Rules:
- Read files before modifying them to understand existing patterns
- Follow the existing code style and conventions of the project
- Only modify files relevant to the current task
- Do not refactor unrelated code
- Do not add unnecessary abstractions or over-engineer
- Do not leave TODO comments, console.logs, or dead code behind
- When done, briefly state what you changed and why`);

  if (context.techStack) {
    sections.push(`Tech stack: ${context.techStack}`);
  }

  if (context.testFramework) {
    sections.push(`Test framework: ${context.testFramework}`);
  }

  if (context.projectConventions) {
    sections.push(`Project conventions:\n${context.projectConventions}`);
  }

  return sections.join('\n\n');
}
