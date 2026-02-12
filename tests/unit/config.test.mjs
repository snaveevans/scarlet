import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../../src/config/index.mjs';

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-config-'));
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeConfig(obj) {
  const p = path.join(tmpDir, 'config.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

function minimalConfig() {
  return {
    targetRepo: { localPath: '/tmp/test-repo' },
    agent: { type: 'mock' },
  };
}

describe('config', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('loads a minimal config with defaults', () => {
    const p = writeConfig(minimalConfig());
    const config = loadConfig(p);
    assert.equal(config.targetRepo.localPath, '/tmp/test-repo');
    assert.equal(config.targetRepo.mainBranch, 'main');
    assert.equal(config.targetRepo.prdGlob, 'docs/prd/**/*.md');
    assert.equal(config.polling.intervalSeconds, 60);
    assert.equal(config.agent.type, 'mock');
    assert.equal(config.agent.timeout, 300);
    assert.equal(config.git.branchPrefix, 'scarlet/');
    assert.equal(config.git.createPr, true);
    assert.equal(config.state.path, '.scarlet/state.json');
    assert.equal(config.logging.level, 'info');
  });

  it('rejects config missing required fields', () => {
    const p = writeConfig({ targetRepo: { localPath: '/tmp' } });
    assert.throws(() => loadConfig(p), /Invalid config/);
  });

  it('rejects invalid agent type', () => {
    const p = writeConfig({
      targetRepo: { localPath: '/tmp' },
      agent: { type: 'nonexistent' },
    });
    assert.throws(() => loadConfig(p), /Invalid config/);
  });

  it('interpolates env variables', () => {
    process.env.SCARLET_TEST_TOKEN = 'my-secret-token';
    const p = writeConfig({
      ...minimalConfig(),
      git: { githubToken: '${SCARLET_TEST_TOKEN}' },
    });
    const config = loadConfig(p);
    assert.equal(config.git.githubToken, 'my-secret-token');
    delete process.env.SCARLET_TEST_TOKEN;
  });

  it('replaces missing env vars with empty string', () => {
    delete process.env.SCARLET_NONEXISTENT_VAR;
    const p = writeConfig({
      ...minimalConfig(),
      git: { githubToken: '${SCARLET_NONEXISTENT_VAR}' },
    });
    const config = loadConfig(p);
    assert.equal(config.git.githubToken, '');
  });

  it('rejects invalid polling interval', () => {
    const p = writeConfig({
      ...minimalConfig(),
      polling: { intervalSeconds: 2 },
    });
    assert.throws(() => loadConfig(p), /Invalid config/);
  });

  it('accepts a full config', () => {
    const p = writeConfig({
      targetRepo: {
        localPath: '/tmp/test',
        remoteUrl: 'git@github.com:org/repo.git',
        mainBranch: 'develop',
        prdGlob: 'prds/*.json',
      },
      polling: { intervalSeconds: 30 },
      agent: { type: 'opencode', command: 'opencode', timeout: 600 },
      git: {
        branchPrefix: 'auto/',
        commitAuthor: 'Bot <bot@test.com>',
        githubToken: 'abc',
        createPr: false,
      },
      state: { path: '.state/data.json' },
      logging: { level: 'debug', file: 'logs/out.log' },
    });
    const config = loadConfig(p);
    assert.equal(config.targetRepo.mainBranch, 'develop');
    assert.equal(config.agent.command, 'opencode');
    assert.equal(config.git.createPr, false);
    assert.equal(config.logging.level, 'debug');
  });

  it('throws on invalid JSON', () => {
    const p = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(p, 'not json');
    assert.throws(() => loadConfig(p));
  });
});
