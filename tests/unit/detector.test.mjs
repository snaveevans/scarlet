import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { detectPrdChanges } from '../../src/detector/index.mjs';
import { createStateManager } from '../../src/state/index.mjs';

let tmpDir;

function gitInit(dir) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function gitCommitAll(dir, msg = 'commit') {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', msg, '--allow-empty'], { cwd: dir });
}

function getHead(dir) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
}

describe('detector', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-detector-'));
    gitInit(tmpDir);
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects new PRD files in a commit range', async () => {
    // Initial commit
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'hello');
    gitCommitAll(tmpDir, 'init');
    const from = getHead(tmpDir);

    // Add a PRD
    fs.mkdirSync(path.join(tmpDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'my-feature.md'), '# PRD: My Feature\n\nDo the thing.');
    gitCommitAll(tmpDir, 'add prd');
    const to = getHead(tmpDir);

    const sm = createStateManager(path.join(tmpDir, '.scarlet', 'state.json'));
    const changes = await detectPrdChanges({
      cwd: tmpDir,
      fromCommit: from,
      toCommit: to,
      prdGlob: 'docs/prd/**/*.md',
      stateManager: sm,
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].filePath, 'docs/prd/my-feature.md');
    assert.ok(changes[0].content.includes('My Feature'));
    assert.ok(changes[0].contentHash);
  });

  it('filters out template files', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'PRD_TEMPLATE.md'), '# Template');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'real.md'), '# PRD: Real');
    gitCommitAll(tmpDir, 'init');

    const sm = createStateManager(path.join(tmpDir, '.scarlet', 'state.json'));
    const changes = await detectPrdChanges({
      cwd: tmpDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: 'docs/prd/**/*.md',
      stateManager: sm,
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].filePath, 'docs/prd/real.md');
  });

  it('skips already-processed PRDs with same hash', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'feature.md'), '# PRD: Feature');
    gitCommitAll(tmpDir, 'init');

    const sm = createStateManager(path.join(tmpDir, '.scarlet', 'state.json'));
    const content = '# PRD: Feature';
    const hash = sm.contentHash(content);

    sm.save({
      lastProcessedCommit: null,
      processedPrds: {
        'docs/prd/feature.md': { status: 'completed', contentHash: hash },
      },
    });

    const changes = await detectPrdChanges({
      cwd: tmpDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: 'docs/prd/**/*.md',
      stateManager: sm,
    });

    assert.equal(changes.length, 0);
  });

  it('detects modified PRDs with different hash', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'feature.md'), '# PRD: Feature v2');
    gitCommitAll(tmpDir, 'init');

    const sm = createStateManager(path.join(tmpDir, '.scarlet', 'state.json'));
    sm.save({
      lastProcessedCommit: null,
      processedPrds: {
        'docs/prd/feature.md': { status: 'completed', contentHash: 'old-hash' },
      },
    });

    const changes = await detectPrdChanges({
      cwd: tmpDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: 'docs/prd/**/*.md',
      stateManager: sm,
    });

    assert.equal(changes.length, 1);
  });

  it('scans all PRDs on first run (no from commit)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'a.md'), '# A');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd', 'b.md'), '# B');
    gitCommitAll(tmpDir, 'init');

    const sm = createStateManager(path.join(tmpDir, '.scarlet', 'state.json'));
    const changes = await detectPrdChanges({
      cwd: tmpDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: 'docs/prd/**/*.md',
      stateManager: sm,
    });

    assert.equal(changes.length, 2);
  });
});
