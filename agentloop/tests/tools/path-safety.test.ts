import { describe, it, expect } from 'vitest';
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
});
