import { runShell, runShellCommand } from './shell.js';

export interface GitOptions {
  cwd: string;
}

/**
 * Create and checkout a branch. If the branch already exists, just check it out.
 * Uses spawn args directly to avoid shell injection via branch names.
 */
export async function createAndCheckoutBranch(
  branchName: string,
  options: GitOptions,
): Promise<void> {
  const create = await runShell('git', ['checkout', '-b', branchName], options);

  if (create.exitCode !== 0) {
    // Branch may already exist — just check it out
    const checkout = await runShell('git', ['checkout', branchName], options);
    if (checkout.exitCode !== 0) {
      throw new Error(
        `Failed to checkout branch ${branchName}: ${checkout.stderr}`,
      );
    }
  }
}

/**
 * Stage all changes and commit with the given message.
 * Returns the short SHA of the new commit.
 * Uses spawn args directly to avoid shell injection via commit messages.
 */
export async function stageAndCommit(
  message: string,
  options: GitOptions,
): Promise<string> {
  const add = await runShell('git', ['add', '-A'], options);
  if (add.exitCode !== 0) {
    throw new Error(`git add failed: ${add.stderr}`);
  }

  const commit = await runShell('git', ['commit', '-m', message], options);

  if (commit.exitCode !== 0) {
    // Nothing to commit is not an error
    if (commit.stdout.includes('nothing to commit')) {
      return '';
    }
    throw new Error(`git commit failed: ${commit.stderr}`);
  }

  // Extract short SHA from commit output
  const shaMatch = /\[.+\s([0-9a-f]+)\]/.exec(commit.stdout);
  return shaMatch?.[1] ?? '';
}

/**
 * Get the current HEAD short SHA.
 */
export async function getCurrentSha(options: GitOptions): Promise<string> {
  const result = await runShell('git', ['rev-parse', '--short', 'HEAD'], options);
  if (result.exitCode !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/**
 * Check if the working tree has uncommitted changes.
 */
export async function hasChanges(options: GitOptions): Promise<boolean> {
  const result = await runShell('git', ['status', '--porcelain'], options);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

/**
 * Sanitize a PRD name for use as a branch name.
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
