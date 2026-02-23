import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import type { KnowledgeEntryType, KnowledgeStore } from './store.js';
import {
  AgentToolSchema,
  PitfallSchema,
  SkillSchema,
  type AgentTool,
  type Pitfall,
  type Skill,
} from './types.js';

const SKILLS_FILE = 'skills.json';
const PITFALLS_FILE = 'pitfalls.json';

export class FileKnowledgeStore implements KnowledgeStore {
  private readonly knowledgeDir: string;
  private readonly toolsDir: string;
  private readonly archiveDir: string;
  private readonly archivedToolsDir: string;
  private readonly skillsPath: string;
  private readonly pitfallsPath: string;
  private readonly archivedSkillsPath: string;
  private readonly archivedPitfallsPath: string;

  constructor(private readonly projectRoot: string) {
    this.knowledgeDir = join(projectRoot, '.scarlet', 'knowledge');
    this.toolsDir = join(this.knowledgeDir, 'tools');
    this.archiveDir = join(this.knowledgeDir, 'archive');
    this.archivedToolsDir = join(this.archiveDir, 'tools');
    this.skillsPath = join(this.knowledgeDir, SKILLS_FILE);
    this.pitfallsPath = join(this.knowledgeDir, PITFALLS_FILE);
    this.archivedSkillsPath = join(this.archiveDir, SKILLS_FILE);
    this.archivedPitfallsPath = join(this.archiveDir, PITFALLS_FILE);
    this.ensureDirectories();
  }

  querySkills(query: string, limit = 5): Skill[] {
    return rankResults(
      this.allSkills(),
      query,
      (skill) => [
        skill.name,
        skill.description,
        skill.content,
        skill.trigger.join(' '),
        skill.tags.join(' '),
      ],
      (skill) => skill.usageCount,
      limit,
    );
  }

  queryPitfalls(query: string, limit = 5): Pitfall[] {
    return rankResults(
      this.allPitfalls(),
      query,
      (pitfall) => [
        pitfall.description,
        pitfall.context,
        pitfall.rootCause,
        pitfall.avoidance,
        pitfall.tags.join(' '),
      ],
      (pitfall) => pitfall.occurrences,
      limit,
    );
  }

  queryTools(query: string, limit = 5): AgentTool[] {
    return rankResults(
      this.allTools(),
      query,
      (tool) => [tool.name, tool.description, tool.type, tool.content],
      (tool) => tool.usageCount,
      limit,
    );
  }

  saveSkill(skill: Omit<Skill, 'id'>): Skill {
    const allIds = [
      ...this.allSkills().map((item) => item.id),
      ...this.readSkillArray(this.archivedSkillsPath).map((item) => item.id),
    ];
    const saved = SkillSchema.parse({
      ...skill,
      id: nextId('skill', allIds),
      confidence: clamp(skill.confidence, 0, 1),
    });

    const skills = this.allSkills();
    skills.push(saved);
    this.writeArray(this.skillsPath, skills);
    return saved;
  }

  savePitfall(pitfall: Omit<Pitfall, 'id'>): Pitfall {
    const allIds = [
      ...this.allPitfalls().map((item) => item.id),
      ...this.readPitfallArray(this.archivedPitfallsPath).map((item) => item.id),
    ];
    const saved = PitfallSchema.parse({
      ...pitfall,
      id: nextId('pitfall', allIds),
    });

    const pitfalls = this.allPitfalls();
    pitfalls.push(saved);
    this.writeArray(this.pitfallsPath, pitfalls);
    return saved;
  }

  saveTool(tool: Omit<AgentTool, 'id'>): AgentTool {
    const allIds = [
      ...this.allTools().map((item) => item.id),
      ...this.loadArchivedTools().map((item) => item.id),
    ];
    const saved = AgentToolSchema.parse({
      ...tool,
      id: nextId('tool', allIds),
    });
    this.writeTool(saved, false);
    return saved;
  }

  updateConfidence(skillId: string, delta: number): void {
    const skills = this.allSkills();
    const index = skills.findIndex((skill) => skill.id === skillId);
    if (index === -1) {
      throw new Error(`Unknown skill: ${skillId}`);
    }
    const existing = skills[index]!;
    skills[index] = {
      ...existing,
      confidence: clamp(existing.confidence + delta, 0, 1),
    };
    this.writeArray(this.skillsPath, skills);
  }

  recordUsage(id: string, type: KnowledgeEntryType): void {
    const now = new Date().toISOString();

    if (type === 'skill') {
      const skills = this.allSkills();
      const index = skills.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown skill: ${id}`);
      const current = skills[index]!;
      skills[index] = {
        ...current,
        usageCount: current.usageCount + 1,
        lastUsed: now,
      };
      this.writeArray(this.skillsPath, skills);
      return;
    }

    if (type === 'pitfall') {
      const pitfalls = this.allPitfalls();
      const index = pitfalls.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown pitfall: ${id}`);
      const current = pitfalls[index]!;
      pitfalls[index] = {
        ...current,
        occurrences: current.occurrences + 1,
        lastTriggered: now,
      };
      this.writeArray(this.pitfallsPath, pitfalls);
      return;
    }

    const tool = this.loadToolById(id, false);
    if (!tool) {
      throw new Error(`Unknown tool: ${id}`);
    }
    this.writeTool(
      {
        ...tool,
        usageCount: tool.usageCount + 1,
        lastUsed: now,
      },
      false,
    );
  }

  archive(id: string, type: KnowledgeEntryType): void {
    if (type === 'skill') {
      const skills = this.allSkills();
      const index = skills.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown skill: ${id}`);
      const [archived] = skills.splice(index, 1);
      this.writeArray(this.skillsPath, skills);
      const existingArchived = this.readSkillArray(this.archivedSkillsPath);
      this.writeArray(this.archivedSkillsPath, [...existingArchived, archived!]);
      return;
    }

    if (type === 'pitfall') {
      const pitfalls = this.allPitfalls();
      const index = pitfalls.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown pitfall: ${id}`);
      const [archived] = pitfalls.splice(index, 1);
      this.writeArray(this.pitfallsPath, pitfalls);
      const existingArchived = this.readPitfallArray(this.archivedPitfallsPath);
      this.writeArray(this.archivedPitfallsPath, [...existingArchived, archived!]);
      return;
    }

    const source = this.toolPath(id, false);
    if (!existsSync(source)) {
      throw new Error(`Unknown tool: ${id}`);
    }
    mkdirSync(this.archivedToolsDir, { recursive: true });
    const destination = this.toolPath(id, true);
    renameSync(source, destination);
  }

  prune(existingFiles: string[]): { archived: number } {
    const existingSet = new Set(existingFiles.map((file) => this.normalizePath(file)));
    let archivedCount = 0;

    const skills = this.allSkills();
    const keepSkills = skills.filter((skill) => {
      if (!hasStaleReferences(skill.references, existingSet, this.normalizePath.bind(this))) {
        return true;
      }
      archivedCount++;
      return false;
    });
    if (keepSkills.length !== skills.length) {
      const stale = skills.filter((skill) => !keepSkills.some((keep) => keep.id === skill.id));
      const archivedSkills = this.readSkillArray(this.archivedSkillsPath);
      this.writeArray(this.skillsPath, keepSkills);
      this.writeArray(this.archivedSkillsPath, [...archivedSkills, ...stale]);
    }

    const pitfalls = this.allPitfalls();
    const keepPitfalls = pitfalls.filter((pitfall) => {
      if (!hasStaleReferences(pitfall.references, existingSet, this.normalizePath.bind(this))) {
        return true;
      }
      archivedCount++;
      return false;
    });
    if (keepPitfalls.length !== pitfalls.length) {
      const stale = pitfalls.filter(
        (pitfall) => !keepPitfalls.some((keep) => keep.id === pitfall.id),
      );
      const archivedPitfalls = this.readPitfallArray(this.archivedPitfallsPath);
      this.writeArray(this.pitfallsPath, keepPitfalls);
      this.writeArray(this.archivedPitfallsPath, [...archivedPitfalls, ...stale]);
    }

    for (const tool of this.allTools()) {
      if (!hasStaleReferences(tool.references, existingSet, this.normalizePath.bind(this))) {
        continue;
      }
      this.archive(tool.id, 'tool');
      archivedCount++;
    }

    return { archived: archivedCount };
  }

  allSkills(): Skill[] {
    return this.readSkillArray(this.skillsPath);
  }

  allPitfalls(): Pitfall[] {
    return this.readPitfallArray(this.pitfallsPath);
  }

  allTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    if (!existsSync(this.toolsDir)) {
      return tools;
    }

    for (const entry of readdirSync(this.toolsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const filePath = join(this.toolsDir, entry.name);
      const parsed = this.readJson(filePath);
      if (!parsed.ok) {
        continue;
      }
      const result = AgentToolSchema.safeParse(parsed.value);
      if (!result.success) {
        this.backupCorruptFile(filePath);
        continue;
      }
      tools.push(result.data);
    }

    return tools.sort((a, b) => a.id.localeCompare(b.id));
  }

  private loadArchivedTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    if (!existsSync(this.archivedToolsDir)) {
      return tools;
    }

    for (const entry of readdirSync(this.archivedToolsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const filePath = join(this.archivedToolsDir, entry.name);
      const parsed = this.readJson(filePath);
      if (!parsed.ok) {
        continue;
      }
      const result = AgentToolSchema.safeParse(parsed.value);
      if (!result.success) {
        this.backupCorruptFile(filePath);
        continue;
      }
      tools.push(result.data);
    }

    return tools;
  }

  private loadToolById(id: string, archived: boolean): AgentTool | undefined {
    const path = this.toolPath(id, archived);
    if (!existsSync(path)) {
      return undefined;
    }
    const parsed = this.readJson(path);
    if (!parsed.ok) {
      return undefined;
    }
    const result = AgentToolSchema.safeParse(parsed.value);
    if (!result.success) {
      this.backupCorruptFile(path);
      return undefined;
    }
    return result.data;
  }

  private readSkillArray(filePath: string): Skill[] {
    return this.readArray(filePath, (value) => z.array(SkillSchema).parse(value));
  }

  private readPitfallArray(filePath: string): Pitfall[] {
    return this.readArray(filePath, (value) => z.array(PitfallSchema).parse(value));
  }

  private readArray<T>(filePath: string, parser: (value: unknown) => T[]): T[] {
    if (!existsSync(filePath)) {
      return [];
    }

    const parsed = this.readJson(filePath);
    if (!parsed.ok) {
      return [];
    }

    try {
      return parser(parsed.value);
    } catch {
      this.backupCorruptFile(filePath);
      return [];
    }
  }

  private readJson(filePath: string): { ok: true; value: unknown } | { ok: false } {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch {
      this.backupCorruptFile(filePath);
      return { ok: false };
    }
  }

  private writeArray(filePath: string, data: unknown): void {
    this.writeJsonAtomic(filePath, data);
  }

  private writeTool(tool: AgentTool, archived: boolean): void {
    const filePath = this.toolPath(tool.id, archived);
    this.writeJsonAtomic(filePath, tool);
  }

  private writeJsonAtomic(filePath: string, data: unknown): void {
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tempPath, filePath);
  }

  private backupCorruptFile(filePath: string): void {
    if (!existsSync(filePath)) return;
    const backupPath = `${filePath}.bak.${Date.now()}`;
    try {
      renameSync(filePath, backupPath);
    } catch {
      // Ignore backup failures and continue with fresh state.
    }
  }

  private toolPath(id: string, archived: boolean): string {
    if (!/^[a-z0-9-]+$/i.test(id)) {
      throw new Error(`Invalid tool id: ${id}`);
    }
    return join(archived ? this.archivedToolsDir : this.toolsDir, `${id}.json`);
  }

  private normalizePath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (isAbsolute(trimmed)) {
      const rel = relative(this.projectRoot, trimmed).replace(/\\/g, '/');
      return rel.startsWith('..') ? trimmed.replace(/\\/g, '/') : stripDotSlash(rel);
    }

    return stripDotSlash(trimmed.replace(/\\/g, '/'));
  }

  private ensureDirectories(): void {
    mkdirSync(this.knowledgeDir, { recursive: true });
    mkdirSync(this.toolsDir, { recursive: true });
    mkdirSync(this.archiveDir, { recursive: true });
  }
}

function nextId(prefix: 'skill' | 'pitfall' | 'tool', ids: string[]): string {
  const max = ids.reduce((highest, id) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (!match) return highest;
    return Math.max(highest, Number.parseInt(match[1]!, 10));
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9_.-/]+/g) ?? [];
}

function score(queryTokens: string[], haystack: string): number {
  if (queryTokens.length === 0) return 1;
  const normalized = haystack.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (normalized.includes(token)) {
      matched++;
    }
  }
  return matched;
}

function rankResults<T>(
  items: T[],
  query: string,
  textSelector: (item: T) => string[],
  usageSelector: (item: T) => number,
  limit: number,
): T[] {
  const queryTokens = tokenize(query);
  const ranked = items
    .map((item) => ({
      item,
      score: score(queryTokens, textSelector(item).join(' ')),
      usage: usageSelector(item),
    }))
    .filter((entry) => queryTokens.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || b.usage - a.usage);

  return ranked.slice(0, Math.min(limit, ranked.length)).map((entry) => entry.item);
}

function stripDotSlash(value: string): string {
  return value.replace(/^\.\//, '');
}

function hasStaleReferences(
  references: string[],
  existingFiles: Set<string>,
  normalizePath: (value: string) => string,
): boolean {
  if (references.length === 0) {
    return false;
  }

  return references.some((reference) => {
    const normalized = normalizePath(reference);
    return normalized.length > 0 && !existingFiles.has(normalized);
  });
}
