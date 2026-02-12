import fs from 'node:fs';
import path from 'node:path';
import * as gitOps from '../git-ops/index.mjs';

export async function detectPrdChanges({ cwd, fromCommit, toCommit, prdGlob, stateManager }) {
  const state = stateManager.load();
  const changes = [];

  let changedFiles;
  if (fromCommit) {
    changedFiles = await gitOps.diffNameOnly(cwd, fromCommit, toCommit, prdGlob);
  } else {
    // First run: scan all existing PRDs
    changedFiles = await gitOps.lsFiles(cwd, prdGlob);
  }

  // Filter out template files
  changedFiles = changedFiles.filter(f => !path.basename(f).includes('TEMPLATE'));

  for (const filePath of changedFiles) {
    const fullPath = path.join(cwd, filePath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const hash = stateManager.contentHash(content);

    const existing = state.processedPrds[filePath];
    if (existing && existing.contentHash === hash) continue; // unchanged

    changes.push({ filePath, content, contentHash: hash });
  }

  return changes;
}
