import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function git(args, cwd, opts = {}) {
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: opts.timeoutMs,
  });
}

async function githubRequest({ method = 'GET', url, token, body, timeoutMs = 15000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await globalThis.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) return null;
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetch(cwd, remote = 'origin') {
  await git(['fetch', remote], cwd, { timeoutMs: 60000 });
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

export async function stagePaths(cwd, paths) {
  const uniquePaths = Array.from(new Set((paths ?? []).filter(Boolean)));
  if (uniquePaths.length === 0) return;
  await git(['add', '-A', '--', ...uniquePaths], cwd);
}

export async function statusPorcelain(cwd) {
  const { stdout } = await git(['status', '--porcelain'], cwd);
  return stdout.trim().split('\n').filter(Boolean);
}

export async function stagedDiff(cwd) {
  const { stdout } = await git(['diff', '--cached'], cwd);
  return stdout;
}

export async function commit(cwd, message, author) {
  const args = ['commit', '-m', message];
  if (author) args.push('--author', author);
  await git(args, cwd);
}

export async function push(cwd, remote = 'origin', branch) {
  await git(['push', '-u', remote, branch], cwd);
}

export async function branchExistsRemote(cwd, remote, branchName) {
  const { stdout } = await git(['ls-remote', '--heads', remote, branchName], cwd);
  return Boolean(stdout.trim());
}

export async function addDetachedWorktree(cwd, worktreePath, ref) {
  await git(['worktree', 'add', '--detach', worktreePath, ref], cwd);
}

export async function removeWorktree(cwd, worktreePath) {
  await git(['worktree', 'remove', '--force', worktreePath], cwd);
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
  const data = await githubRequest({
    method: 'POST',
    url,
    token,
    body: { title, body, head, base },
  });

  return { number: data.number, url: data.html_url };
}

export async function findOpenPullRequest({ owner, repo, head, base, token }) {
  const params = new URLSearchParams({
    state: 'open',
    head: `${owner}:${head}`,
    base,
    per_page: '100',
  });
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?${params.toString()}`;
  const pulls = await githubRequest({ method: 'GET', url, token });
  if (!Array.isArray(pulls) || pulls.length === 0) return null;
  const pr = pulls[0];
  return { number: pr.number, url: pr.html_url };
}

export async function updatePullRequest({ owner, repo, number, title, body, state, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
  const payload = {};
  if (typeof title === 'string') payload.title = title;
  if (typeof body === 'string') payload.body = body;
  if (typeof state === 'string') payload.state = state;

  const pr = await githubRequest({ method: 'PATCH', url, token, body: payload });
  return { number: pr.number, url: pr.html_url };
}
