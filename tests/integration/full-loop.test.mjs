import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../src/config/index.mjs';
import { createStateManager } from '../../src/state/index.mjs';
import { detectPrdChanges } from '../../src/detector/index.mjs';
import { planFromPrd } from '../../src/planner/index.mjs';
import { execute } from '../../src/executor/index.mjs';
import * as gitOps from '../../src/git-ops/index.mjs';

let tmpDir, repoDir, configPath;

function git(args, cwd) {
  return execFileSync('git', args, { cwd }).toString().trim();
}

function setupRepo() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-integration-'));
  repoDir = path.join(tmpDir, 'target-repo');
  fs.mkdirSync(repoDir);

  git(['init', '-b', 'main'], repoDir);
  git(['config', 'user.email', 'test@test.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);

  // Initial commit
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test Repo');
  git(['add', '-A'], repoDir);
  git(['commit', '-m', 'init'], repoDir);

  // Write config
  configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    targetRepo: {
      localPath: repoDir,
      mainBranch: 'main',
      prdGlob: 'docs/prd/**/*.md',
    },
    agent: { type: 'mock' },
    git: {
      branchPrefix: 'scarlet/',
      commitAuthor: 'Scarlet <scarlet@test.com>',
      createPr: false,
    },
    state: { path: '.scarlet/state.json' },
    logging: { level: 'debug' },
  }));
}

describe('full loop integration', () => {
  beforeEach(setupRepo);
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a new PRD, runs mock agent, creates branch with commit', async () => {
    // Add a PRD
    fs.mkdirSync(path.join(repoDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, 'docs', 'prd', 'add-widget.md'),
      '# PRD: Add Widget\n\nAdd a widget component that displays data.'
    );
    git(['add', '-A'], repoDir);
    git(['commit', '-m', 'add prd'], repoDir);

    const config = loadConfig(configPath);
    const statePath = path.resolve(repoDir, config.state.path);
    const stateManager = createStateManager(statePath);

    // Detect changes (first run, no prior state)
    const changes = await detectPrdChanges({
      cwd: repoDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: config.targetRepo.prdGlob,
      stateManager,
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].filePath, 'docs/prd/add-widget.md');

    // Plan
    const plan = planFromPrd(changes[0].content, changes[0].filePath);
    assert.equal(plan.title, 'Add Widget');
    assert.equal(plan.branchName, 'add-widget');

    const fullBranchName = config.git.branchPrefix + plan.branchName;

    // Create branch
    await gitOps.createBranch(repoDir, fullBranchName);
    const branch = await gitOps.currentBranch(repoDir);
    assert.equal(branch, fullBranchName);

    // Execute mock agent
    const result = await execute({
      agentType: 'mock',
      workingDirectory: repoDir,
      instructions: plan.instructions,
      branchName: plan.branchName,
      timeout: 30,
    });

    assert.equal(result.success, true);
    assert.ok(result.filesChanged.length > 0);

    // Stage and commit
    await gitOps.stageAll(repoDir);
    await gitOps.commit(repoDir, `feat: implement ${plan.title}`, config.git.commitAuthor);

    // Verify the commit exists on the branch
    const log = git(['log', '--oneline', '-1'], repoDir);
    assert.ok(log.includes('implement Add Widget'));

    // Verify the file was created
    assert.ok(fs.existsSync(path.join(repoDir, 'add-widget.md')));

    // Update state
    const state = stateManager.load();
    state.processedPrds[changes[0].filePath] = {
      status: 'completed',
      branchName: fullBranchName,
      contentHash: changes[0].contentHash,
      processedAt: new Date().toISOString(),
    };
    state.lastProcessedCommit = git(['rev-parse', 'HEAD'], repoDir);
    stateManager.save(state);

    // Verify state persisted
    const savedState = stateManager.load();
    assert.equal(savedState.processedPrds['docs/prd/add-widget.md'].status, 'completed');

    // Verify re-detection skips already-processed PRD
    await gitOps.checkout(repoDir, 'main');
    const changes2 = await detectPrdChanges({
      cwd: repoDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: config.targetRepo.prdGlob,
      stateManager,
    });
    assert.equal(changes2.length, 0);
  });

  it('handles multiple PRDs in one cycle', async () => {
    fs.mkdirSync(path.join(repoDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'docs', 'prd', 'feature-a.md'), '# PRD: Feature A\n\nDetails A.');
    fs.writeFileSync(path.join(repoDir, 'docs', 'prd', 'feature-b.md'), '# PRD: Feature B\n\nDetails B.');
    git(['add', '-A'], repoDir);
    git(['commit', '-m', 'add prds'], repoDir);

    const config = loadConfig(configPath);
    const statePath = path.resolve(repoDir, config.state.path);
    const stateManager = createStateManager(statePath);

    const changes = await detectPrdChanges({
      cwd: repoDir,
      fromCommit: null,
      toCommit: 'HEAD',
      prdGlob: config.targetRepo.prdGlob,
      stateManager,
    });

    assert.equal(changes.length, 2);
    const paths = changes.map(c => c.filePath).sort();
    assert.deepEqual(paths, ['docs/prd/feature-a.md', 'docs/prd/feature-b.md']);
  });

  it('detects modified PRD after initial processing', async () => {
    fs.mkdirSync(path.join(repoDir, 'docs', 'prd'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'docs', 'prd', 'evolving.md'), '# PRD: Evolving\n\nVersion 1.');
    git(['add', '-A'], repoDir);
    git(['commit', '-m', 'add prd'], repoDir);

    const config = loadConfig(configPath);
    const statePath = path.resolve(repoDir, config.state.path);
    const stateManager = createStateManager(statePath);

    // First detection
    const changes1 = await detectPrdChanges({
      cwd: repoDir, fromCommit: null, toCommit: 'HEAD',
      prdGlob: config.targetRepo.prdGlob, stateManager,
    });
    assert.equal(changes1.length, 1);

    // Mark as processed
    const state = stateManager.load();
    state.processedPrds['docs/prd/evolving.md'] = {
      status: 'completed',
      contentHash: changes1[0].contentHash,
      processedAt: new Date().toISOString(),
    };
    stateManager.save(state);

    // Modify the PRD
    fs.writeFileSync(path.join(repoDir, 'docs', 'prd', 'evolving.md'), '# PRD: Evolving\n\nVersion 2 with new requirements.');
    git(['add', '-A'], repoDir);
    git(['commit', '-m', 'update prd'], repoDir);

    // Re-detect
    const changes2 = await detectPrdChanges({
      cwd: repoDir, fromCommit: null, toCommit: 'HEAD',
      prdGlob: config.targetRepo.prdGlob, stateManager,
    });
    assert.equal(changes2.length, 1);
    assert.ok(changes2[0].content.includes('Version 2'));
  });
});
