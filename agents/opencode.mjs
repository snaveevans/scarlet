import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function execute({ workingDirectory, instructions, branchName, timeout = 300, command = 'opencode' }) {
  const timeoutMs = timeout * 1000;

  const prompt = [
    instructions,
    '',
    `When done, make sure all changes are saved. Do not commit — Scarlet will handle that.`,
  ].join('\n');

  try {
    const { stdout, stderr } = await execFileAsync(
      command,
      ['--prompt', prompt],
      {
        cwd: workingDirectory,
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env },
      }
    );

    // Check for changed files via git status
    const { stdout: statusOut } = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: workingDirectory }
    );

    const filesChanged = statusOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => line.slice(3));

    return {
      success: filesChanged.length > 0,
      filesChanged,
      logs: stdout + (stderr ? '\n' + stderr : ''),
    };
  } catch (err) {
    return {
      success: false,
      filesChanged: [],
      logs: `Agent error: ${err.message}`,
    };
  }
}
