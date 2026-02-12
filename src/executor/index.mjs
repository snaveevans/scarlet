import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '../../agents');

const agentCache = new Map();

async function loadAgent(type) {
  if (agentCache.has(type)) return agentCache.get(type);
  const agentPath = path.join(AGENTS_DIR, `${type}.mjs`);
  const mod = await import(agentPath);
  agentCache.set(type, mod);
  return mod;
}

export async function execute({ agentType, workingDirectory, instructions, branchName, timeout, command }) {
  const agent = await loadAgent(agentType);
  return agent.execute({ workingDirectory, instructions, branchName, timeout, command });
}
