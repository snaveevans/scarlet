import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileTool } from '../../src/tools/read-file.js';
import { writeFileTool } from '../../src/tools/write-file.js';
import { editFileTool } from '../../src/tools/edit-file.js';
import { listDirectoryTool } from '../../src/tools/list-directory.js';
import type { ToolContext } from '../../src/tools/types.js';

let tempDir: string;
let ctx: ToolContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scarlet-tools-test-'));
  ctx = { projectRoot: tempDir };

  // Create fixture files
  mkdirSync(join(tempDir, 'src'));
  writeFileSync(join(tempDir, 'src', 'index.ts'), 'export const x = 1;\nexport const y = 2;\nexport const z = 3;\n');
  writeFileSync(join(tempDir, 'readme.md'), '# Hello\n');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

describe('read_file', () => {
  it('reads an existing file', async () => {
    const result = await readFileTool.execute({ path: 'src/index.ts' }, ctx);
    expect(result).toContain('export const x = 1;');
  });

  it('reads with offset and limit', async () => {
    const result = await readFileTool.execute(
      { path: 'src/index.ts', offset: 2, limit: 1 },
      ctx,
    );
    expect(result).toBe('export const y = 2;');
  });

  it('throws for nonexistent file', async () => {
    await expect(
      readFileTool.execute({ path: 'nope.ts' }, ctx),
    ).rejects.toThrow('Cannot read file');
  });

  it('rejects path traversal', async () => {
    await expect(
      readFileTool.execute({ path: '../../etc/passwd' }, ctx),
    ).rejects.toThrow('outside the project root');
  });

  it('rejects .git access', async () => {
    await expect(
      readFileTool.execute({ path: '.git/config' }, ctx),
    ).rejects.toThrow('.git/ internals');
  });

  it('throws for non-string path', async () => {
    await expect(
      readFileTool.execute({ path: 123 }, ctx),
    ).rejects.toThrow('path must be a string');
  });
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

describe('write_file', () => {
  it('creates a new file', async () => {
    const result = await writeFileTool.execute(
      { path: 'new-file.ts', content: 'hello' },
      ctx,
    );
    expect(result).toContain('new-file.ts');
    expect(readFileSync(join(tempDir, 'new-file.ts'), 'utf-8')).toBe('hello');
  });

  it('creates parent directories', async () => {
    await writeFileTool.execute(
      { path: 'deep/nested/dir/file.ts', content: 'nested' },
      ctx,
    );
    expect(readFileSync(join(tempDir, 'deep/nested/dir/file.ts'), 'utf-8')).toBe(
      'nested',
    );
  });

  it('overwrites existing file', async () => {
    await writeFileTool.execute(
      { path: 'readme.md', content: 'new content' },
      ctx,
    );
    expect(readFileSync(join(tempDir, 'readme.md'), 'utf-8')).toBe('new content');
  });

  it('rejects path traversal', async () => {
    await expect(
      writeFileTool.execute(
        { path: '../escape.txt', content: 'bad' },
        ctx,
      ),
    ).rejects.toThrow('outside the project root');
  });
});

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

describe('edit_file', () => {
  it('replaces a unique string', async () => {
    const result = await editFileTool.execute(
      {
        path: 'src/index.ts',
        old_string: 'export const x = 1;',
        new_string: 'export const x = 42;',
      },
      ctx,
    );
    expect(result).toContain('1 occurrence');
    const content = readFileSync(join(tempDir, 'src/index.ts'), 'utf-8');
    expect(content).toContain('export const x = 42;');
    expect(content).not.toContain('export const x = 1;');
  });

  it('throws when old_string not found', async () => {
    await expect(
      editFileTool.execute(
        {
          path: 'src/index.ts',
          old_string: 'nonexistent string',
          new_string: 'replacement',
        },
        ctx,
      ),
    ).rejects.toThrow('not found');
  });

  it('throws when old_string appears multiple times without replace_all', async () => {
    writeFileSync(join(tempDir, 'dup.ts'), 'foo\nfoo\n');

    await expect(
      editFileTool.execute(
        { path: 'dup.ts', old_string: 'foo', new_string: 'bar' },
        ctx,
      ),
    ).rejects.toThrow('multiple times');
  });

  it('replaces all occurrences with replace_all', async () => {
    writeFileSync(join(tempDir, 'dup.ts'), 'foo\nfoo\nfoo\n');

    const result = await editFileTool.execute(
      {
        path: 'dup.ts',
        old_string: 'foo',
        new_string: 'bar',
        replace_all: true,
      },
      ctx,
    );
    expect(result).toContain('3 occurrence');
    expect(readFileSync(join(tempDir, 'dup.ts'), 'utf-8')).toBe('bar\nbar\nbar\n');
  });

  it('rejects path traversal', async () => {
    await expect(
      editFileTool.execute(
        {
          path: '../../etc/hosts',
          old_string: 'a',
          new_string: 'b',
        },
        ctx,
      ),
    ).rejects.toThrow('outside the project root');
  });
});

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

describe('list_directory', () => {
  it('lists root directory', async () => {
    const result = await listDirectoryTool.execute({}, ctx);
    expect(result).toContain('readme.md');
    expect(result).toContain('src/');
  });

  it('lists subdirectory', async () => {
    const result = await listDirectoryTool.execute({ path: 'src' }, ctx);
    expect(result).toContain('src/index.ts');
  });

  it('lists recursively', async () => {
    const result = await listDirectoryTool.execute(
      { path: '.', recursive: true },
      ctx,
    );
    expect(result).toContain('src/');
    expect(result).toContain('src/index.ts');
  });

  it('ignores node_modules and .git', async () => {
    mkdirSync(join(tempDir, 'node_modules'));
    writeFileSync(join(tempDir, 'node_modules', 'pkg.json'), '{}');
    mkdirSync(join(tempDir, '.git'));

    const result = await listDirectoryTool.execute(
      { path: '.', recursive: true },
      ctx,
    );
    expect(result).not.toContain('node_modules');
    expect(result).not.toContain('.git');
  });

  it('returns empty message for empty dir', async () => {
    mkdirSync(join(tempDir, 'empty'));
    const result = await listDirectoryTool.execute({ path: 'empty' }, ctx);
    expect(result).toBe('(empty directory)');
  });
});
