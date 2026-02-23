import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safePath } from '../../src/tools/types.js';

describe('safePath', () => {
  const root = '/home/user/project';

  it('resolves relative paths within project', () => {
    expect(safePath(root, 'src/index.ts')).toBe('/home/user/project/src/index.ts');
  });

  it('resolves . to project root', () => {
    expect(safePath(root, '.')).toBe('/home/user/project');
  });

  it('resolves nested relative paths', () => {
    expect(safePath(root, 'src/../lib/util.ts')).toBe(
      '/home/user/project/lib/util.ts',
    );
  });

  it('rejects paths that escape project root', () => {
    expect(() => safePath(root, '../outside')).toThrow('outside the project root');
    expect(() => safePath(root, '../../etc/passwd')).toThrow(
      'outside the project root',
    );
  });

  it('rejects absolute paths outside project', () => {
    expect(() => safePath(root, '/etc/passwd')).toThrow(
      'outside the project root',
    );
  });

  it('rejects .git internals', () => {
    expect(() => safePath(root, '.git/config')).toThrow('.git/ internals');
    expect(() => safePath(root, '.git/HEAD')).toThrow('.git/ internals');
  });

  it('allows .gitignore', () => {
    expect(safePath(root, '.gitignore')).toBe('/home/user/project/.gitignore');
  });

  it('allows .github directory', () => {
    expect(safePath(root, '.github/workflows/ci.yml')).toBe(
      '/home/user/project/.github/workflows/ci.yml',
    );
  });

  it('allows .scarlet directory', () => {
    expect(safePath(root, '.scarlet/knowledge/skills.json')).toBe(
      '/home/user/project/.scarlet/knowledge/skills.json',
    );
  });

  it('rejects paths containing null bytes', () => {
    expect(() => safePath(root, 'src/index\0.ts')).toThrow('null byte');
    expect(() => safePath(root, '\0etc/passwd')).toThrow('null byte');
  });
});

describe('safePath symlink handling', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scarlet-path-test-'));
    mkdirSync(join(tempDir, 'src'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows symlinks that stay within project root', () => {
    // Create a symlink inside the project pointing to another location inside
    symlinkSync(join(tempDir, 'src'), join(tempDir, 'link-to-src'));
    expect(() => safePath(tempDir, 'link-to-src')).not.toThrow();
  });

  it('rejects symlinks that escape project root', () => {
    // Create a symlink inside the project pointing to /tmp (outside project)
    symlinkSync('/tmp', join(tempDir, 'escape-link'));
    expect(() => safePath(tempDir, 'escape-link')).toThrow(
      'outside the project root',
    );
  });

  it('rejects symlinks to sensitive locations', () => {
    symlinkSync('/etc', join(tempDir, 'etc-link'));
    expect(() => safePath(tempDir, 'etc-link')).toThrow(
      'outside the project root',
    );
  });
});
