import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const EMPTY_STATE = {
  lastProcessedCommit: null,
  processedPrds: {},
};

export function createStateManager(statePath) {
  const dir = path.dirname(statePath);

  function load() {
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      return { ...EMPTY_STATE, ...JSON.parse(raw) };
    } catch (err) {
      if (err.code === 'ENOENT') return { ...EMPTY_STATE };
      throw err;
    }
  }

  function save(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.state-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, statePath);
  }

  function contentHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  return { load, save, contentHash };
}
