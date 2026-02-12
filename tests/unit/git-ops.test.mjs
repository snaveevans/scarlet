import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as gitOps from '../../src/git-ops/index.mjs';

let tmpDir;

function gitInit(dir) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

describe('git-ops', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-gitops-'));
    gitInit(tmpDir);
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('revParse resolves HEAD', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    const sha = await gitOps.revParse(tmpDir, 'HEAD');
    assert.match(sha, /^[0-9a-f]{40}$/);
  });

  it('createBranch and currentBranch', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    await gitOps.createBranch(tmpDir, 'test-branch');
    const branch = await gitOps.currentBranch(tmpDir);
    assert.equal(branch, 'test-branch');
  });

  it('stageAll and commit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'new file');
    await gitOps.stageAll(tmpDir);
    await gitOps.commit(tmpDir, 'add new file', 'Bot <bot@test.com>');

    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: tmpDir }).toString();
    assert.ok(log.includes('add new file'));
  });

  it('diffNameOnly shows changed files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });
    const from = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir }).toString().trim();

    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'prd.md'), 'prd');
    fs.writeFileSync(path.join(tmpDir, 'other.txt'), 'other');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'add files'], { cwd: tmpDir });
    const to = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir }).toString().trim();

    const all = await gitOps.diffNameOnly(tmpDir, from, to);
    assert.ok(all.includes('docs/prd.md'));
    assert.ok(all.includes('other.txt'));

    const filtered = await gitOps.diffNameOnly(tmpDir, from, to, 'docs/**');
    assert.ok(filtered.includes('docs/prd.md'));
    assert.ok(!filtered.includes('other.txt'));
  });

  it('checkout switches branches', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    await gitOps.createBranch(tmpDir, 'feature');
    await gitOps.checkout(tmpDir, 'main');
    const branch = await gitOps.currentBranch(tmpDir);
    assert.equal(branch, 'main');
  });

  it('lsFiles lists tracked files', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'a.md'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'b.md'), 'b');
    fs.writeFileSync(path.join(tmpDir, 'other.txt'), 'o');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    const files = await gitOps.lsFiles(tmpDir, 'docs/**/*.md');
    assert.equal(files.length, 2);
    assert.ok(files.includes('docs/a.md'));
  });

  it('stagePaths stages only selected paths', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a1');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b1');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a2');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b2');

    await gitOps.stagePaths(tmpDir, ['a.txt']);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: tmpDir }).toString();

    assert.ok(status.includes('M  a.txt'));
    assert.ok(status.includes(' M b.txt'));
  });
});
