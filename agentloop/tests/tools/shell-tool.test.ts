import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shellTool } from '../../src/tools/shell-tool.js';
import type { ToolContext } from '../../src/tools/types.js';

let tempDir: string;
let ctx: ToolContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scarlet-shell-test-'));
  ctx = { projectRoot: tempDir };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('shell tool', () => {
  it('runs a command and returns output', async () => {
    const result = await shellTool.execute(
      { command: 'echo "hello world"' },
      ctx,
    );
    expect(result).toContain('Exit code: 0');
    expect(result).toContain('hello world');
  });

  it('returns exit code on failure', async () => {
    const result = await shellTool.execute(
      { command: 'exit 42' },
      ctx,
    );
    expect(result).toContain('Exit code: 42');
  });

  it('captures stderr', async () => {
    const result = await shellTool.execute(
      { command: 'echo "error msg" >&2' },
      ctx,
    );
    expect(result).toContain('stderr:');
    expect(result).toContain('error msg');
  });

  it('requires command to be a string', async () => {
    await expect(
      shellTool.execute({ command: 123 }, ctx),
    ).rejects.toThrow('command must be a string');
  });

  it('respects working_dir', async () => {
    const result = await shellTool.execute(
      { command: 'pwd', working_dir: '.' },
      ctx,
    );
    expect(result).toContain(tempDir);
  });
});
