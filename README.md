# Scarlet

Autonomous coding agent that watches a git repo for PRD changes, dispatches a coding agent to implement them, and opens a pull request.

```
POLL → DETECT → PLAN → EXECUTE → DELIVER → (repeat)
```

## Quick Start

```bash
git clone https://github.com/snaveevans/scarlet.git
cd scarlet
bash install.sh myproject
```

The install script will:

1. Verify Node.js 20+ is installed
2. Install npm dependencies
3. Create a dedicated `scarlet` system user
4. Copy an example config to `/etc/scarlet/myproject.json`
5. Install and verify a systemd service (`scarlet@myproject`)
6. Print next steps

After install, edit the config and start:

```bash
sudo vi /etc/scarlet/myproject.json   # set your repo path, agent, token
sudo systemctl enable --now scarlet@myproject
```

## Configuration

Each Scarlet instance is configured with a JSON file. The install script places configs at `/etc/scarlet/<name>.json`.

### Example Config

```json
{
  "targetRepo": {
    "localPath": "/home/user/projects/my-project",
    "remoteUrl": "git@github.com:org/my-project.git",
    "mainBranch": "main",
    "prdGlob": "docs/prd/**/*.md"
  },
  "polling": {
    "intervalSeconds": 60
  },
  "agent": {
    "type": "mock",
    "timeout": 300
  },
  "git": {
    "branchPrefix": "scarlet/",
    "commitAuthor": "Scarlet Agent <scarlet@example.com>",
    "githubToken": "${GITHUB_TOKEN}",
    "createPr": true
  },
  "state": {
    "path": "/var/lib/scarlet/state.json"
  },
  "logging": {
    "level": "info",
    "file": "/var/log/scarlet/scarlet.log"
  }
}
```

### Config Reference

#### `targetRepo` (required)

| Field        | Required | Default            | Description                                                 |
| ------------ | -------- | ------------------ | ----------------------------------------------------------- |
| `localPath`  | **yes**  | —                  | Absolute path to the target git repo on disk                |
| `remoteUrl`  | no       | —                  | Git remote URL (required when `git.createPr` is `true`)      |
| `mainBranch` | no       | `main`             | Branch to track for PRD changes                             |
| `prdGlob`    | no       | `docs/prd/**/*.md` | Glob pattern for PRD files (supports `*.json`, `*.jsonl`)   |

#### `polling`

| Field             | Default | Description                              |
| ----------------- | ------- | ---------------------------------------- |
| `intervalSeconds` | `60`    | Seconds between poll cycles (minimum: 5) |

#### `agent` (required)

| Field     | Required | Default | Description                                        |
| --------- | -------- | ------- | -------------------------------------------------- |
| `type`    | **yes**  | —       | Agent to use: `mock` or `opencode`                 |
| `command` | no       | —       | CLI command to invoke the agent (e.g., `opencode`) |
| `timeout` | no       | `300`   | Agent execution timeout in seconds (minimum: 10)   |

#### `git`

| Field          | Default                               | Description                                             |
| -------------- | ------------------------------------- | ------------------------------------------------------- |
| `branchPrefix` | `scarlet/`                            | Prefix for branches Scarlet creates                     |
| `commitAuthor` | `Scarlet Agent <scarlet@example.com>` | Git author string for commits                           |
| `githubToken`  | —                                     | GitHub token for PR creation (supports `${VAR}` syntax) |
| `createPr`     | `true`                                | Whether to create a pull request after pushing          |

#### `state`

| Field  | Default               | Description                                         |
| ------ | --------------------- | --------------------------------------------------- |
| `path` | `/var/lib/scarlet/state.json` | State file path. Relative paths resolve from `targetRepo.localPath` |

#### `logging`

| Field   | Default | Description                                         |
| ------- | ------- | --------------------------------------------------- |
| `level` | `info`  | Minimum log level: `debug`, `info`, `warn`, `error` |
| `file`  | —       | Optional log file path. Relative paths resolve from `targetRepo.localPath` |

### Environment Variable Interpolation

Any string value in the config can use `${VAR_NAME}` to reference environment variables. This is the recommended way to inject secrets like `githubToken`.

When running via systemd, create an env file at `/etc/scarlet/<name>.env`:

```bash
# /etc/scarlet/myproject.env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

The systemd service loads this file automatically via `EnvironmentFile`.

File permissions are set to `640` with group `scarlet` during install.

When running manually, export the variable or use an env prefix:

```bash
GITHUB_TOKEN=ghp_xxx node src/index.mjs --config configs/myproject.json
```

## Running

### With systemd (recommended)

```bash
# Enable and start
sudo systemctl enable --now scarlet@myproject

# Check status
sudo systemctl status scarlet@myproject

# View logs
journalctl -u scarlet@myproject -f

# Restart after config change
sudo systemctl restart scarlet@myproject

# Stop
sudo systemctl stop scarlet@myproject
```

### Manually

```bash
# Continuous polling
node src/index.mjs --config configs/myproject.json

# Single poll cycle (useful for testing/cron)
node src/index.mjs --config configs/myproject.json --once
```

### With Docker

```bash
npm run docker:build
npm run docker:test    # runs with seed repo + mock agent
```

## Failure Notifications

- If PRD processing fails, Scarlet creates or updates a **single failure PR per PRD**.
- Failure PRs include a report file at `docs/scarlet/failures/*.md` with redacted/truncated logs.
- On successful processing of that PRD later, Scarlet closes the open failure PR automatically.
- If any PRD fails in a cycle, Scarlet keeps `lastProcessedCommit` unchanged so failures are retried.

## Running Multiple Instances

Each instance watches one repo. Run multiple instances by creating separate configs:

```bash
sudo cp /etc/scarlet/myproject.json /etc/scarlet/other-project.json
sudo vi /etc/scarlet/other-project.json
sudo systemctl enable --now scarlet@other-project
```

## Tests

```bash
npm test                # all tests
npm run test:unit       # unit tests only
npm run test:integration # integration tests only
```

## Architecture

- `src/config/` — Config loading, validation, env interpolation
- `src/logger/` — Structured JSON logger (stdout + file)
- `src/git-ops/` — Git commands (fetch, diff, branch, commit, push, PR)
- `src/state/` — JSON file state persistence
- `src/detector/` — PRD change detection
- `src/planner/` — PRD → agent instructions
- `src/executor/` — Agent dispatch layer
- `src/redaction/` — Secret redaction and detection helpers
- `agents/` — Agent adapters (`mock`, `opencode`)
- `schemas/` — JSON schemas for config validation
