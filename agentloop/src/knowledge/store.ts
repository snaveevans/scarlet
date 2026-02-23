import type { AgentTool, Pitfall, Skill } from './types.js';

export type KnowledgeEntryType = 'skill' | 'pitfall' | 'tool';

export interface KnowledgeStore {
  querySkills(query: string, limit?: number): Skill[];
  queryPitfalls(query: string, limit?: number): Pitfall[];
  queryTools(query: string, limit?: number): AgentTool[];

  saveSkill(skill: Omit<Skill, 'id'>): Skill;
  savePitfall(pitfall: Omit<Pitfall, 'id'>): Pitfall;
  saveTool(tool: Omit<AgentTool, 'id'>): AgentTool;

  updateConfidence(skillId: string, delta: number): void;
  recordUsage(id: string, type: KnowledgeEntryType): void;
  archive(id: string, type: KnowledgeEntryType): void;
  prune(existingFiles: string[]): { archived: number };

  allSkills(): Skill[];
  allPitfalls(): Pitfall[];
  allTools(): AgentTool[];
}
