import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStateManager } from '../../src/state/index.mjs';

let tmpDir;

describe('state', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-state-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty state when file does not exist', () => {
    const sm = createStateManager(path.join(tmpDir, 'state.json'));
    const state = sm.load();
    assert.equal(state.lastProcessedCommit, null);
    assert.deepEqual(state.processedPrds, {});
  });

  it('saves and loads state', () => {
    const sm = createStateManager(path.join(tmpDir, 'state.json'));
    const state = {
      lastProcessedCommit: 'abc123',
      processedPrds: {
        'docs/prd/test.md': { status: 'completed', contentHash: 'hash1' },
      },
    };
    sm.save(state);
    const loaded = sm.load();
    assert.deepEqual(loaded, state);
  });

  it('creates directory if needed', () => {
    const sm = createStateManager(path.join(tmpDir, 'sub', 'dir', 'state.json'));
    sm.save({ lastProcessedCommit: null, processedPrds: {} });
    assert.ok(fs.existsSync(path.join(tmpDir, 'sub', 'dir', 'state.json')));
  });

  it('generates consistent content hashes', () => {
    const sm = createStateManager(path.join(tmpDir, 'state.json'));
    const hash1 = sm.contentHash('hello world');
    const hash2 = sm.contentHash('hello world');
    const hash3 = sm.contentHash('different content');
    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 16);
  });

  it('overwrites existing state', () => {
    const sm = createStateManager(path.join(tmpDir, 'state.json'));
    sm.save({ lastProcessedCommit: 'first', processedPrds: {} });
    sm.save({ lastProcessedCommit: 'second', processedPrds: {} });
    const loaded = sm.load();
    assert.equal(loaded.lastProcessedCommit, 'second');
  });
});
