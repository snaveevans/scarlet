import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchFilesTool } from '../../src/tools/search-files.js';
import { findFilesTool } from '../../src/tools/find-files.js';
import { globToRegex } from '../../src/tools/find-files.js';
import type { ToolContext } from '../../src/tools/types.js';

let tempDir: string;
let ctx: ToolContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scarlet-search-test-'));
  ctx = { projectRoot: tempDir };

  mkdirSync(join(tempDir, 'src'));
  mkdirSync(join(tempDir, 'src', 'utils'));
  writeFileSync(
    join(tempDir, 'src', 'index.ts'),
    'export function hello() {\n  return "world";\n}\n',
  );
  writeFileSync(
    join(tempDir, 'src', 'utils', 'helper.ts'),
    'export function add(a: number, b: number) {\n  return a + b;\n}\n',
  );
  writeFileSync(
    join(tempDir, 'src', 'utils', 'helper.test.ts'),
    'import { add } from "./helper";\n',
  );
  writeFileSync(join(tempDir, 'readme.md'), '# Project\nSome text here\n');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// search_files
// ---------------------------------------------------------------------------

describe('search_files', () => {
  it('finds matching content', async () => {
    const result = await searchFilesTool.execute(
      { pattern: 'export function' },
      ctx,
    );
    expect(result).toContain('hello');
    expect(result).toContain('add');
  });

  it('returns no matches message for unmatched pattern', async () => {
    const result = await searchFilesTool.execute(
      { pattern: 'zzz_nonexistent_zzz' },
      ctx,
    );
    expect(result).toContain('No matches found');
  });

  it('respects file_pattern filter', async () => {
    const result = await searchFilesTool.execute(
      { pattern: 'export', file_pattern: '*.md' },
      ctx,
    );
    // .md files don't contain 'export'
    expect(result).toContain('No matches found');
  });

  it('rejects path traversal', async () => {
    await expect(
      searchFilesTool.execute(
        { pattern: 'test', path: '../../' },
        ctx,
      ),
    ).rejects.toThrow('outside the project root');
  });

  it('requires pattern to be a string', async () => {
    await expect(
      searchFilesTool.execute({ pattern: 123 }, ctx),
    ).rejects.toThrow('pattern must be a string');
  });
});

// ---------------------------------------------------------------------------
// find_files
// ---------------------------------------------------------------------------

describe('find_files', () => {
  it('finds files matching wildcard pattern', async () => {
    const result = await findFilesTool.execute(
      { pattern: '*.ts' },
      ctx,
    );
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils/helper.ts');
    expect(result).toContain('src/utils/helper.test.ts');
  });

  it('finds files matching specific pattern', async () => {
    const result = await findFilesTool.execute(
      { pattern: '*.test.ts' },
      ctx,
    );
    expect(result).toContain('helper.test.ts');
    expect(result).not.toContain('index.ts');
  });

  it('finds markdown files', async () => {
    const result = await findFilesTool.execute(
      { pattern: '*.md' },
      ctx,
    );
    expect(result).toContain('readme.md');
  });

  it('respects max_results', async () => {
    const result = await findFilesTool.execute(
      { pattern: '*.ts', max_results: 1 },
      ctx,
    );
    const lines = result.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('returns message when no files match', async () => {
    const result = await findFilesTool.execute(
      { pattern: '*.xyz' },
      ctx,
    );
    expect(result).toContain('No files found');
  });

  it('searches within subdirectory', async () => {
    const result = await findFilesTool.execute(
      { pattern: '*.ts', path: 'src/utils' },
      ctx,
    );
    expect(result).toContain('helper.ts');
    expect(result).not.toContain('index.ts');
  });
});

// ---------------------------------------------------------------------------
// globToRegex
// ---------------------------------------------------------------------------

describe('globToRegex', () => {
  it('converts * to .*', () => {
    const regex = globToRegex('*.ts');
    expect(regex.test('index.ts')).toBe(true);
    expect(regex.test('foo.ts')).toBe(true);
    expect(regex.test('foo.js')).toBe(false);
  });

  it('handles *.test.ts pattern', () => {
    const regex = globToRegex('*.test.ts');
    expect(regex.test('helper.test.ts')).toBe(true);
    expect(regex.test('helper.ts')).toBe(false);
  });

  it('escapes special regex chars', () => {
    const regex = globToRegex('file[1].ts');
    expect(regex.test('file[1].ts')).toBe(true);
    expect(regex.test('fileX.ts')).toBe(false);
  });
});
