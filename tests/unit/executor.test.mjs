import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execute } from '../../src/executor/index.mjs';

let tmpDir;

describe('executor', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-executor-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes mock agent successfully', async () => {
    const result = await execute({
      agentType: 'mock',
      workingDirectory: tmpDir,
      instructions: 'Build a widget',
      branchName: 'build-widget',
      timeout: 30,
    });

    assert.equal(result.success, true);
    assert.ok(result.filesChanged.length > 0);
    assert.ok(fs.existsSync(path.join(tmpDir, 'build-widget.md')));

    const content = fs.readFileSync(path.join(tmpDir, 'build-widget.md'), 'utf-8');
    assert.ok(content.includes('Build a widget'));
  });

  it('throws for unknown agent type', async () => {
    await assert.rejects(
      execute({
        agentType: 'nonexistent',
        workingDirectory: tmpDir,
        instructions: 'test',
        branchName: 'test',
        timeout: 30,
      }),
      /Cannot find module/
    );
  });
});
