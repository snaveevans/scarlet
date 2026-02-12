import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config/index.mjs';
import { createLogger } from './logger/index.mjs';
import { createStateManager } from './state/index.mjs';
import { detectPrdChanges } from './detector/index.mjs';
import { planFromPrd } from './planner/index.mjs';
import { execute } from './executor/index.mjs';
import * as gitOps from './git-ops/index.mjs';

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    once: { type: 'boolean', default: false },
  },
});

if (!args.config) {
  console.error('Usage: node src/index.mjs --config <path>');
  process.exit(1);
}

const config = loadConfig(args.config);
const logger = createLogger({
  level: config.logging.level,
  file: config.logging.file
    ? path.resolve(config.targetRepo.localPath, config.logging.file)
    : undefined,
});

const statePath = path.resolve(config.targetRepo.localPath, config.state.path);
const stateManager = createStateManager(statePath);

// Ensure .scarlet is gitignored in the target repo
const gitignorePath = path.join(config.targetRepo.localPath, '.gitignore');
try {
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  if (!existing.includes('.scarlet/')) {
    fs.appendFileSync(gitignorePath, '\n.scarlet/\n');
  }
} catch { /* best effort */ }

let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

async function pollCycle() {
  const cwd = config.targetRepo.localPath;
  const mainBranch = config.targetRepo.mainBranch;

  logger.info('Starting poll cycle');

  // Fetch latest
  try {
    await gitOps.fetch(cwd);
  } catch (err) {
    logger.warn('Fetch failed, skipping cycle', { error: err.message });
    return;
  }

  // Get current remote HEAD
  let remoteHead;
  try {
    remoteHead = await gitOps.revParse(cwd, `origin/${mainBranch}`);
  } catch (err) {
    logger.error('Failed to resolve remote HEAD', { error: err.message });
    return;
  }

  const state = stateManager.load();
  const fromCommit = state.lastProcessedCommit;

  if (fromCommit === remoteHead) {
    logger.info('No new commits');
    return;
  }

  // Detect PRD changes
  let changes;
  try {
    changes = await detectPrdChanges({
      cwd,
      fromCommit,
      toCommit: remoteHead,
      prdGlob: config.targetRepo.prdGlob,
      stateManager,
    });
  } catch (err) {
    logger.error('Detection failed', { error: err.message });
    return;
  }

  if (changes.length === 0) {
    logger.info('No PRD changes detected');
    state.lastProcessedCommit = remoteHead;
    stateManager.save(state);
    return;
  }

  logger.info(`Found ${changes.length} PRD change(s)`);

  // Process each PRD
  for (const change of changes) {
    const { filePath, content, contentHash } = change;
    logger.info(`Processing PRD: ${filePath}`);

    const plan = planFromPrd(content, filePath);
    const fullBranchName = config.git.branchPrefix + plan.branchName;

    try {
      // Ensure we're on main before branching
      await gitOps.checkout(cwd, mainBranch);
      // Pull latest
      try { await gitOps.checkout(cwd, `origin/${mainBranch}`); } catch { /* detached HEAD ok */ }
      await gitOps.checkout(cwd, mainBranch);

      // Create working branch
      try {
        await gitOps.createBranch(cwd, fullBranchName, `origin/${mainBranch}`);
      } catch {
        // Branch may already exist
        await gitOps.checkout(cwd, fullBranchName);
      }

      // Execute agent
      const result = await execute({
        agentType: config.agent.type,
        workingDirectory: cwd,
        instructions: plan.instructions,
        branchName: plan.branchName,
        timeout: config.agent.timeout,
        command: config.agent.command,
      });

      if (!result.success) {
        logger.error(`Agent failed for ${filePath}`, { logs: result.logs });
        state.processedPrds[filePath] = {
          status: 'failed',
          branchName: fullBranchName,
          contentHash,
          processedAt: new Date().toISOString(),
          error: result.logs,
        };
        stateManager.save(state);
        await gitOps.checkout(cwd, mainBranch);
        continue;
      }

      // Stage and commit
      await gitOps.stageAll(cwd);
      await gitOps.commit(cwd, `feat: implement ${plan.title}`, config.git.commitAuthor);

      // Push
      try {
        await gitOps.push(cwd, 'origin', fullBranchName);
      } catch (err) {
        logger.error(`Push failed for ${filePath}`, { error: err.message });
      }

      // Create PR
      let prUrl = null;
      if (config.git.createPr && config.git.githubToken) {
        try {
          const remote = config.targetRepo.remoteUrl || '';
          const match = remote.match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
          if (match) {
            const [, owner, repo] = match;
            const pr = await gitOps.createPullRequest({
              owner,
              repo,
              head: fullBranchName,
              base: mainBranch,
              title: `feat: ${plan.title}`,
              body: `Implements PRD: \`${filePath}\`\n\nGenerated by Scarlet.`,
              token: config.git.githubToken,
            });
            prUrl = pr.url;
            logger.info(`PR created: ${prUrl}`);
          }
        } catch (err) {
          logger.error(`PR creation failed for ${filePath}`, { error: err.message });
        }
      }

      state.processedPrds[filePath] = {
        status: 'completed',
        branchName: fullBranchName,
        prUrl,
        contentHash,
        processedAt: new Date().toISOString(),
      };
      stateManager.save(state);

      // Return to main
      await gitOps.checkout(cwd, mainBranch);

      logger.info(`Completed PRD: ${filePath}`);
    } catch (err) {
      logger.error(`Failed processing ${filePath}`, { error: err.message });
      await gitOps.checkout(cwd, mainBranch).catch(() => {});
    }
  }

  // Update last processed commit
  state.lastProcessedCommit = remoteHead;
  stateManager.save(state);
}

async function main() {
  logger.info('Scarlet starting', { config: args.config });

  if (args.once) {
    await pollCycle();
    logger.info('Single run complete');
    logger.close();
    return;
  }

  while (running) {
    try {
      await pollCycle();
    } catch (err) {
      logger.error('Unexpected error in poll cycle', { error: err.message });
    }
    // Wait for next interval
    const waitMs = config.polling.intervalSeconds * 1000;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, waitMs);
      const check = setInterval(() => {
        if (!running) { clearTimeout(timer); clearInterval(check); resolve(); }
      }, 500);
    });
  }

  logger.info('Scarlet shutting down');
  logger.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
