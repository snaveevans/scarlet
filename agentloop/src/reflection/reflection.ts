import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ImplementationPlan, CodebaseUnderstanding } from '../comprehension/types.js';
import { generateContext } from '../knowledge/context-generator.js';
import type { KnowledgeStore } from '../knowledge/store.js';
import type { Pitfall, Skill } from '../knowledge/types.js';
import type { LLMClient } from '../llm/client.js';
import type { Task } from '../types.js';
import { buildReflectionPrompt, REFLECTION_SYSTEM_PROMPT } from './prompts.js';
import { stripCodeFence } from '../utils/markdown.js';

export interface ReflectionOptions {
  prdName: string;
  projectRoot: string;
  tasks: Task[];
  plan: ImplementationPlan;
  diff: string;
  progressLog: string;
  llmClient: LLMClient;
  knowledgeStore: KnowledgeStore;
  understanding?: CodebaseUnderstanding | undefined;
  model?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

export interface ReflectionResult {
  skillsExtracted: Skill[];
  pitfallsExtracted: Pitfall[];
  toolCandidates: string[];
  contextUpdates: string[];
  contextPath: string;
}

const SIMILARITY_THRESHOLD = 0.8;
const SKILL_CONFIDENCE_DELTA = 0.1;

const ExtractedSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: z.array(z.string()).default([]),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});

type ExtractedSkill = z.infer<typeof ExtractedSkillSchema>;

const ExtractedPitfallSchema = z.object({
  description: z.string(),
  context: z.string(),
  rootCause: z.string(),
  avoidance: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  tags: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});

type ExtractedPitfall = z.infer<typeof ExtractedPitfallSchema>;

const ReflectionPayloadSchema = z.object({
  skills: z.array(ExtractedSkillSchema).default([]),
  pitfalls: z.array(ExtractedPitfallSchema).default([]),
  toolCandidates: z.array(z.string()).default([]),
  contextUpdates: z.array(z.string()).default([]),
});

type ReflectionPayload = z.infer<typeof ReflectionPayloadSchema>;

export async function runReflection(
  options: ReflectionOptions,
): Promise<ReflectionResult> {
  const prompt = buildReflectionPrompt({
    prdName: options.prdName,
    tasks: options.tasks,
    plan: options.plan,
    diff: options.diff,
    progressLog: options.progressLog,
  });

  const response = await options.llmClient.complete({
    messages: [{ role: 'user', content: prompt }],
    system: REFLECTION_SYSTEM_PROMPT,
    model: options.model,
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');

  const payload = parseReflectionResult(text);
  const now = new Date().toISOString();

  const skillsExtracted = persistSkills(
    payload.skills,
    options.knowledgeStore,
    now,
    options.prdName,
  );

  const pitfallsExtracted = persistPitfalls(
    payload.pitfalls,
    options.knowledgeStore,
    now,
    options.prdName,
  );

  const understanding = options.understanding ?? deriveUnderstandingFromPlan(options.plan);
  const contextPath = writeContextFile(
    options.projectRoot,
    understanding,
    options.knowledgeStore.allSkills(),
    payload.contextUpdates,
  );

  return {
    skillsExtracted,
    pitfallsExtracted,
    toolCandidates: dedupeStrings(payload.toolCandidates),
    contextUpdates: dedupeStrings(payload.contextUpdates),
    contextPath,
  };
}

export function parseReflectionResult(raw: string): ReflectionPayload {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Reflection returned invalid JSON:\n${raw.slice(0, 500)}`);
  }

  const result = ReflectionPayloadSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Reflection output failed validation:\n${issues}`);
  }

  return result.data;
}

function persistSkills(
  extracted: ExtractedSkill[],
  knowledgeStore: KnowledgeStore,
  now: string,
  createdFrom: string,
): Skill[] {
  const persisted: Skill[] = [];
  const currentSkills = knowledgeStore.allSkills();

  for (const candidate of extracted) {
    const duplicate = findSkillDuplicate(candidate, currentSkills);
    if (duplicate) {
      knowledgeStore.updateConfidence(duplicate.id, SKILL_CONFIDENCE_DELTA);
      knowledgeStore.recordUsage(duplicate.id, 'skill');
      const updated =
        knowledgeStore.allSkills().find((skill) => skill.id === duplicate.id) ?? duplicate;
      persisted.push(updated);
      const index = currentSkills.findIndex((skill) => skill.id === duplicate.id);
      if (index !== -1) currentSkills[index] = updated;
      continue;
    }

    const saved = knowledgeStore.saveSkill({
      name: candidate.name,
      description: candidate.description,
      trigger: dedupeStrings(candidate.trigger),
      content: candidate.content,
      projectSpecific: true,
      confidence: 0.5,
      usageCount: 1,
      lastUsed: now,
      createdFrom,
      tags: dedupeStrings(candidate.tags),
      references: dedupeStrings(candidate.references),
    });
    persisted.push(saved);
    currentSkills.push(saved);
  }

  return persisted;
}

function persistPitfalls(
  extracted: ExtractedPitfall[],
  knowledgeStore: KnowledgeStore,
  now: string,
  createdFrom: string,
): Pitfall[] {
  const persisted: Pitfall[] = [];
  const currentPitfalls = knowledgeStore.allPitfalls();

  for (const candidate of extracted) {
    const duplicate = findPitfallDuplicate(candidate, currentPitfalls);
    if (duplicate) {
      knowledgeStore.recordUsage(duplicate.id, 'pitfall');
      const updated =
        knowledgeStore.allPitfalls().find((pitfall) => pitfall.id === duplicate.id) ?? duplicate;
      persisted.push(updated);
      const index = currentPitfalls.findIndex((pitfall) => pitfall.id === duplicate.id);
      if (index !== -1) currentPitfalls[index] = updated;
      continue;
    }

    const saved = knowledgeStore.savePitfall({
      description: candidate.description,
      context: candidate.context,
      rootCause: candidate.rootCause,
      avoidance: candidate.avoidance,
      severity: candidate.severity,
      occurrences: 1,
      createdFrom,
      lastTriggered: now,
      tags: dedupeStrings(candidate.tags),
      references: dedupeStrings(candidate.references),
    });
    persisted.push(saved);
    currentPitfalls.push(saved);
  }

  return persisted;
}

function findSkillDuplicate(candidate: ExtractedSkill, skills: Skill[]): Skill | undefined {
  const candidateText = [
    candidate.name,
    candidate.description,
    candidate.content,
    candidate.trigger.join(' '),
    candidate.tags.join(' '),
  ].join(' ');

  let bestScore = 0;
  let best: Skill | undefined;
  for (const skill of skills) {
    const existingText = [
      skill.name,
      skill.description,
      skill.content,
      skill.trigger.join(' '),
      skill.tags.join(' '),
    ].join(' ');
    const score = similarity(candidateText, existingText);
    if (score > bestScore) {
      bestScore = score;
      best = skill;
    }
  }

  return bestScore >= SIMILARITY_THRESHOLD ? best : undefined;
}

function findPitfallDuplicate(
  candidate: ExtractedPitfall,
  pitfalls: Pitfall[],
): Pitfall | undefined {
  const candidateText = [
    candidate.description,
    candidate.context,
    candidate.rootCause,
    candidate.avoidance,
    candidate.tags.join(' '),
  ].join(' ');

  let bestScore = 0;
  let best: Pitfall | undefined;
  for (const pitfall of pitfalls) {
    const existingText = [
      pitfall.description,
      pitfall.context,
      pitfall.rootCause,
      pitfall.avoidance,
      pitfall.tags.join(' '),
    ].join(' ');
    const score = similarity(candidateText, existingText);
    if (score > bestScore) {
      bestScore = score;
      best = pitfall;
    }
  }

  return bestScore >= SIMILARITY_THRESHOLD ? best : undefined;
}

function writeContextFile(
  projectRoot: string,
  understanding: CodebaseUnderstanding,
  skills: Skill[],
  contextUpdates: string[],
): string {
  const scarletDir = join(projectRoot, '.scarlet');
  mkdirSync(scarletDir, { recursive: true });
  const contextPath = join(scarletDir, 'context.md');

  const previous = existsSync(contextPath)
    ? readFileSync(contextPath, 'utf-8')
    : '';
  const userNotes = extractUserNotes(previous);

  let context = generateContext(understanding, skills);
  context = applyReflectionUpdates(context, contextUpdates);
  context = injectUserNotes(context, userNotes);
  writeFileSync(contextPath, context, 'utf-8');

  return contextPath;
}

function applyReflectionUpdates(context: string, updates: string[]): string {
  const uniqueUpdates = dedupeStrings(updates).filter((update) => update.length > 0);
  if (uniqueUpdates.length === 0) return context;

  const section = [
    '## Reflection Updates',
    ...uniqueUpdates.map((update) => `- ${update}`),
    '',
  ].join('\n');

  // Try to insert before ## Team Notes; if the marker isn't present, append instead
  const marker = '\n## Team Notes';
  if (context.includes(marker)) {
    return context.replace(marker, `\n${section}\n## Team Notes`);
  }

  // Append to end of context
  return context.trimEnd() + '\n\n' + section;
}

function extractUserNotes(content: string): string | undefined {
  const match = /<!-- SCARLET_USER_NOTES_START -->\n([\s\S]*?)\n<!-- SCARLET_USER_NOTES_END -->/.exec(
    content,
  );
  if (!match?.[1]) return undefined;
  return match[1];
}

function injectUserNotes(context: string, notes: string | undefined): string {
  if (!notes) return context;
  return context.replace(
    /<!-- SCARLET_USER_NOTES_START -->\n[\s\S]*?\n<!-- SCARLET_USER_NOTES_END -->/,
    `<!-- SCARLET_USER_NOTES_START -->\n${notes}\n<!-- SCARLET_USER_NOTES_END -->`,
  );
}

function deriveUnderstandingFromPlan(plan: ImplementationPlan): CodebaseUnderstanding {
  const fileToTask = new Map<string, string>();
  for (const task of plan.tasks) {
    for (const path of [...task.filesToCreate, ...task.filesToModify]) {
      if (!fileToTask.has(path)) {
        fileToTask.set(path, task.title);
      }
    }
  }

  const relevantCode = Array.from(fileToTask.entries()).map(([path, title]) => ({
    path,
    purpose: title,
    keyExports: [] as string[],
  }));

  return {
    project: {
      packageManager: 'unknown',
      framework: 'unknown',
      language: inferLanguage(plan.tasks),
      testFramework: 'unknown',
      buildTool: 'unknown',
      commands: {},
    },
    conventions: {
      fileOrganization: 'unknown',
      testOrganization: 'unknown',
      importStyle: 'unknown',
    },
    relevantCode,
  };
}

function inferLanguage(tasks: ImplementationPlan['tasks']): string {
  const files = tasks.flatMap((task) => [...task.filesToCreate, ...task.filesToModify]);
  if (files.some((file) => file.endsWith('.ts') || file.endsWith('.tsx'))) {
    return 'typescript';
  }
  if (files.some((file) => file.endsWith('.js') || file.endsWith('.jsx'))) {
    return 'javascript';
  }
  return 'unknown';
}

function similarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }

  const max = Math.max(aTokens.size, bTokens.size);
  return max === 0 ? 0 : intersection / max;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9_.-/]+/g) ?? [];
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

