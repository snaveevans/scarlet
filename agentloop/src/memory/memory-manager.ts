import type { Message } from '../llm/client.js';
import type { Pitfall, Skill } from '../knowledge/types.js';

export interface MemoryLayer {
  name: string;
  priority: number;
  estimatedTokens: number;
  content: string;
}

export interface MemoryManagerOptions {
  maxTokens: number;
  projectRoot: string;
  contextMd?: string;
}

export interface MemoryManager {
  setSystemContext(systemPrompt: string): void;
  setProjectContext(contextMd: string): void;
  setPhaseContext(phase: string, taskDef: string): void;

  setTaskPlan(plan: string): void;
  setFileContents(files: { path: string; content: string }[]): void;
  setMatchedKnowledge(skills: Skill[], pitfalls: Pitfall[]): void;
  setPreviousError(error: string): void;

  addCompletedTask(taskId: string, title: string, status: string): void;
  addDecision(decision: string): void;
  addModifiedFile(path: string): void;

  buildMessages(userPrompt: string): Message[];
  summarizeSession(): void;
}

interface SessionTask {
  id: string;
  title: string;
  status: string;
}

interface BuildState {
  fileContents: { path: string; content: string }[];
  skills: Skill[];
  pitfalls: Pitfall[];
  sessionSummary: string;
  summarized: boolean;
}

const DEFAULT_SYSTEM_CONTEXT = [
  'You are implementing a task in an existing codebase.',
  'Only modify what is necessary for the current task.',
  'Prefer existing project patterns and explicit error handling.',
].join('\n');

export class LayeredMemoryManager implements MemoryManager {
  private readonly maxTokens: number;
  private readonly projectRoot: string;
  private readonly initialContextMd: string | undefined;

  private systemContext = DEFAULT_SYSTEM_CONTEXT;
  private projectContext = '';
  private phaseContext = '';

  private taskPlan = '';
  private fileContents: { path: string; content: string }[] = [];
  private matchedSkills: Skill[] = [];
  private matchedPitfalls: Pitfall[] = [];
  private previousError = '';

  private completedTasks: SessionTask[] = [];
  private decisions: string[] = [];
  private modifiedFiles = new Set<string>();
  private sessionSummaryOverride: string | undefined;

  constructor(options: MemoryManagerOptions) {
    this.maxTokens = options.maxTokens;
    this.projectRoot = options.projectRoot;
    this.initialContextMd = options.contextMd?.trim() || undefined;
    if (this.initialContextMd) {
      this.projectContext = this.initialContextMd;
    }
  }

  setSystemContext(systemPrompt: string): void {
    this.systemContext = systemPrompt.trim();
  }

  setProjectContext(contextMd: string): void {
    this.projectContext = contextMd.trim();
  }

  setPhaseContext(phase: string, taskDef: string): void {
    this.phaseContext = [`Phase: ${phase}`, taskDef.trim()].join('\n');
  }

  setTaskPlan(plan: string): void {
    this.taskPlan = plan.trim();
  }

  setFileContents(files: { path: string; content: string }[]): void {
    this.fileContents = files
      .map((file) => ({
        path: file.path,
        content: file.content,
      }))
      .filter((file) => file.content.trim().length > 0);
  }

  setMatchedKnowledge(skills: Skill[], pitfalls: Pitfall[]): void {
    this.matchedSkills = [...skills];
    this.matchedPitfalls = [...pitfalls];
  }

  setPreviousError(error: string): void {
    this.previousError = error.trim();
  }

  addCompletedTask(taskId: string, title: string, status: string): void {
    this.completedTasks.push({ id: taskId, title, status });
    this.sessionSummaryOverride = undefined;
  }

  addDecision(decision: string): void {
    if (decision.trim().length === 0) return;
    this.decisions.push(decision.trim());
    this.sessionSummaryOverride = undefined;
  }

  addModifiedFile(path: string): void {
    if (path.trim().length === 0) return;
    this.modifiedFiles.add(path.trim());
    this.sessionSummaryOverride = undefined;
  }

  clearTaskScope(): void {
    this.phaseContext = '';
    this.taskPlan = '';
    this.fileContents = [];
    this.matchedSkills = [];
    this.matchedPitfalls = [];
    this.previousError = '';
  }

  summarizeSession(): void {
    this.sessionSummaryOverride = this.buildSessionSummary();
  }

  buildMessages(userPrompt: string): Message[] {
    const buildState: BuildState = {
      fileContents: [...this.fileContents],
      skills: [...this.matchedSkills],
      pitfalls: [...this.matchedPitfalls],
      sessionSummary: this.renderSessionSection(),
      summarized: false,
    };

    let layers = this.composeLayers(buildState);
    if (this.totalTokens(layers) > this.maxTokens) {
      this.summarizeSession();
      buildState.sessionSummary = this.renderSessionSection();
      buildState.summarized = true;
      layers = this.composeLayers(buildState);
    }

    if (this.totalTokens(layers) > this.maxTokens) {
      buildState.fileContents = buildState.fileContents.map((file) => ({
        path: file.path,
        content: truncateFileContent(file.content, 30, 20),
      }));
      layers = this.composeLayers(buildState);
    }

    if (this.totalTokens(layers) > this.maxTokens) {
      buildState.skills = reduceSkills(buildState.skills);
      buildState.pitfalls = reducePitfalls(buildState.pitfalls);
      layers = this.composeLayers(buildState);
    }

    if (this.totalTokens(layers) > this.maxTokens) {
      buildState.sessionSummary = trimSessionSummary(
        buildState.sessionSummary,
        Math.max(100, this.maxTokens / 5),
      );
      layers = this.composeLayers(buildState);
    }

    const systemLayer = layers.find((layer) => layer.name === 'system');
    const contextLayers = layers.filter((layer) => layer.name !== 'system');
    const contextBlock = contextLayers
      .map((layer) => `## ${layer.name}\n${layer.content}`)
      .join('\n\n');

    return [
      {
        role: 'user',
        content: `## System\n${systemLayer?.content ?? DEFAULT_SYSTEM_CONTEXT}`,
      },
      {
        role: 'user',
        content: contextBlock || '## Context\n(none)',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ];
  }

  private composeLayers(state: BuildState): MemoryLayer[] {
    const layers: MemoryLayer[] = [];

    this.addLayer(layers, 'system', 100, this.systemContext);
    this.addLayer(
      layers,
      'project context',
      95,
      this.projectContext || this.initialContextMd || '',
    );
    this.addLayer(layers, 'phase context', 90, this.phaseContext);
    this.addLayer(layers, 'task plan', 80, this.taskPlan);
    this.addLayer(
      layers,
      'previous error',
      79,
      this.previousError ? `\`\`\`\n${this.previousError}\n\`\`\`` : '',
    );
    this.addLayer(layers, 'file contents', 70, renderFileContents(state.fileContents));
    this.addLayer(
      layers,
      'matched knowledge',
      65,
      renderKnowledge(state.skills, state.pitfalls),
    );
    this.addLayer(layers, 'session context', 50, state.sessionSummary);

    return layers.sort((a, b) => b.priority - a.priority);
  }

  private addLayer(
    layers: MemoryLayer[],
    name: string,
    priority: number,
    content: string,
  ): void {
    const trimmed = content.trim();
    if (!trimmed) return;
    layers.push({
      name,
      priority,
      content: trimmed,
      estimatedTokens: estimateTokens(trimmed),
    });
  }

  private renderSessionSection(): string {
    if (this.sessionSummaryOverride) {
      return this.sessionSummaryOverride;
    }

    const lines: string[] = [];
    if (this.completedTasks.length > 0) {
      lines.push('Completed Tasks:');
      for (const task of this.completedTasks) {
        lines.push(`- ${task.id} ${task.status}: ${task.title}`);
      }
    }

    if (this.decisions.length > 0) {
      lines.push('');
      lines.push('Decisions:');
      for (const decision of this.decisions) {
        lines.push(`- ${decision}`);
      }
    }

    if (this.modifiedFiles.size > 0) {
      lines.push('');
      lines.push(`Modified Files: ${Array.from(this.modifiedFiles).join(', ')}`);
    }

    return lines.join('\n').trim();
  }

  private buildSessionSummary(): string {
    if (this.completedTasks.length === 0) {
      return this.renderSessionSection();
    }

    const total = this.completedTasks.length;
    const passed = this.completedTasks.filter((task) => task.status === 'passed');
    const failed = this.completedTasks.filter((task) => task.status === 'failed');
    const skipped = this.completedTasks.filter((task) => task.status === 'skipped');

    const passedTitles = passed.slice(0, 3).map((task) => task.title).join(', ');
    const parts = [
      `${total} tasks processed`,
      `${passed.length} passed${passedTitles ? ` (${passedTitles})` : ''}`,
      `${failed.length} failed`,
      `${skipped.length} skipped`,
    ];

    const lines = [`Summary: ${parts.join(', ')}`];
    if (this.decisions.length > 0) {
      lines.push(`Decisions tracked: ${this.decisions.length}`);
    }
    if (this.modifiedFiles.size > 0) {
      lines.push(`Modified files tracked: ${this.modifiedFiles.size}`);
    }
    return lines.join('\n');
  }

  private totalTokens(layers: MemoryLayer[]): number {
    return layers.reduce((sum, layer) => sum + layer.estimatedTokens, 0);
  }
}

export function messagesToPrompt(messages: Message[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    )
    .join('\n\n');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderFileContents(
  files: { path: string; content: string }[],
): string {
  if (files.length === 0) return '';
  const sections: string[] = [];
  for (const file of files) {
    sections.push(`### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
  }
  return sections.join('\n\n');
}

function renderKnowledge(skills: Skill[], pitfalls: Pitfall[]): string {
  const lines: string[] = [];

  if (skills.length > 0) {
    lines.push('Skills:');
    for (const skill of skills) {
      lines.push(`- ${skill.name} (confidence ${skill.confidence.toFixed(2)}): ${skill.content}`);
    }
  }

  if (pitfalls.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Pitfalls:');
    for (const pitfall of pitfalls) {
      lines.push(`- [${pitfall.severity}] ${pitfall.description} → ${pitfall.avoidance}`);
    }
  }

  return lines.join('\n');
}

function truncateFileContent(content: string, headLines: number, tailLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= headLines + tailLines + 1) {
    return content;
  }

  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  return [...head, '... [truncated]', ...tail].join('\n');
}

function reduceSkills(skills: Skill[]): Skill[] {
  if (skills.length <= 1) return skills;
  return [...skills]
    .sort((a, b) => b.confidence - a.confidence || b.usageCount - a.usageCount)
    .slice(0, Math.max(1, Math.ceil(skills.length / 2)));
}

function reducePitfalls(pitfalls: Pitfall[]): Pitfall[] {
  if (pitfalls.length <= 1) return pitfalls;
  const severityScore = (severity: Pitfall['severity']): number =>
    severity === 'high' ? 3 : severity === 'medium' ? 2 : 1;

  return [...pitfalls]
    .sort(
      (a, b) =>
        severityScore(b.severity) - severityScore(a.severity) ||
        b.occurrences - a.occurrences,
    )
    .slice(0, Math.max(1, Math.ceil(pitfalls.length / 2)));
}

function trimSessionSummary(summary: string, tokenBudget: number): string {
  const maxChars = Math.max(0, Math.floor(tokenBudget * 4));
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars)}\n... [truncated]`;
}
