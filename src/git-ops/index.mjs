import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function git(args, cwd) {
  return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

export async function fetch(cwd, remote = 'origin') {
  await git(['fetch', remote], cwd);
}

export async function revParse(cwd, ref) {
  const { stdout } = await git(['rev-parse', ref], cwd);
  return stdout.trim();
}

export async function diffNameOnly(cwd, from, to, pathSpec) {
  const args = ['diff', '--name-only', '--diff-filter=AM', `${from}..${to}`];
  if (pathSpec) args.push('--', `:(glob)${pathSpec}`);
  const { stdout } = await git(args, cwd);
  return stdout.trim().split('\n').filter(Boolean);
}

export async function lsFiles(cwd, pathSpec) {
  const args = ['ls-files', '--', `:(glob)${pathSpec}`];
  const { stdout } = await git(args, cwd);
  return stdout.trim().split('\n').filter(Boolean);
}

export async function createBranch(cwd, branchName, startPoint = 'HEAD') {
  await git(['checkout', '-b', branchName, startPoint], cwd);
}

export async function checkout(cwd, ref) {
  await git(['checkout', ref], cwd);
}

export async function stageAll(cwd) {
  await git(['add', '-A'], cwd);
}

export async function commit(cwd, message, author) {
  const args = ['commit', '-m', message];
  if (author) args.push('--author', author);
  await git(args, cwd);
}

export async function push(cwd, remote = 'origin', branch) {
  await git(['push', '-u', remote, branch], cwd);
}

export async function fileContentsAtRef(cwd, ref, filePath) {
  const { stdout } = await git(['show', `${ref}:${filePath}`], cwd);
  return stdout;
}

export async function currentBranch(cwd) {
  const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return stdout.trim();
}

export async function createPullRequest({ owner, repo, head, base, title, body, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return { number: data.number, url: data.html_url };
}
