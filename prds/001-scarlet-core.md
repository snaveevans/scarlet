# PRD: Scarlet Core — Autonomous Agentic Development Daemon

## Context

### Problem Statement

Developers today can use AI coding agents interactively, but there is no hands-off pipeline that takes a merged PRD and autonomously produces a working implementation as a pull request. The feedback loop between "product decision made" and "code ready for review" still requires a human to sit with the agent, manage branches, push code, and open PRs.

### Current Behavior

There is no existing system. The `scarlet` repo is greenfield (empty README, no source code).

### Why Now

AI coding agents (OpenCode, Claude Code, etc.) are capable enough to implement well-scoped features from a detailed PRD. The missing piece is the orchestration layer that connects a product decision (PRD merged to main) to an autonomous implementation cycle — including branching, agent invocation, verification, commit, push, and PR creation — with proper logging, error handling, and security.

---

## Goals

- **G1:** Automatically detect new PRDs merged to a watched branch and kick off an autonomous coding agent to implement them, with zero human intervention between merge and PR creation.
- **G2:** Produce a pull request (or draft PR on failure) containing all implementation artifacts, logs, and verification evidence for every PRD processed.
- **G3:** Provide structured, redacted logging sufficient to diagnose any failure without accessing the machine directly (failure PR includes relevant logs in the body).
- **G4:** Run as a systemd service on Ubuntu with least-privilege principles.
- **G5:** Be testable in a local Docker container (Ubuntu-based) before deployment to physical hardware.

---

## Non-Goals

- **NG1:** Web UI or dashboard — Scarlet is CLI/systemd only for v1. Status is observed via logs, PRs, and `systemctl status`.
- **NG2:** Multi-repo watching in a single Scarlet instance — v1 watches exactly one repo.
- **NG3:** Parallel PRD processing — v1 processes one PRD at a time, serially.
- **NG4:** Automatic merging of the implementation PR — a human always merges.
- **NG5:** Custom agent selection — Scarlet uses OpenCode only.
- **NG6:** Remote log shipping (e.g., to Datadog, Loki) — v1 logs to local disk and includes excerpts in failure PR bodies.
- **NG7:** Windows or macOS deployment — target is Ubuntu (22.04+).
- **NG8:** Managing the PRD authoring process — Scarlet assumes PRDs arrive fully formed and merged.

---

## Users & Use Cases

### Personas

| Persona                  | Description                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Tyler (Operator)**     | Sets up Scarlet on an Ubuntu machine, configures it to watch a target repo, and monitors its output via systemd and GitHub PRs. |
| **Developer (Consumer)** | Merges PRDs into the target repo's main branch and reviews the implementation PRs that Scarlet produces.                        |

### Primary User Journey (Operator)

1. Operator installs Scarlet on an Ubuntu machine (physical, VM, or container).
2. Operator configures Scarlet with: target repo URL, local clone directory, branch to watch, poll interval, and credentials.
3. Operator enables and starts the `scarlet` systemd service.
4. Scarlet begins polling the watched branch for new PRD files.
5. Operator monitors via `systemctl status scarlet` and `journalctl -u scarlet`.

### Primary User Journey (Developer)

1. Developer authors a PRD as a JSON file conforming to the PRD schema (typically with AI assistance).
2. Developer optionally runs the render script locally to preview the human-readable markdown.
3. Developer opens a PR adding the PRD `.json` file to `<repo>/prds/` on the watched branch.
4. PR is reviewed (reviewer reads the auto-rendered markdown or the JSON directly) and merged.
5. Scarlet detects the new PRD, creates a working branch, invokes the coding agent, and opens an implementation PR.
6. Developer reviews the implementation PR (which includes test results, artifacts, and optionally screenshots).
7. Developer merges or requests changes.

---

## Scope

### In-Scope (v1)

- Systemd service unit file and install script for Ubuntu 22.04+
- Configuration file (YAML) with validation (via ajv)
- Git polling loop (configurable interval)
- PRD detection (new `.json` files in `prds/` directory, compared to last-processed commit)
- PRD JSON schema definition and validation
- PRD render script (`scarlet render`) that converts PRD JSON files to human-readable markdown
- Working branch creation (`scarlet/<prd-slug>`)
- OpenCode agent invocation via `opencode run` CLI as a subprocess
- Commit-as-you-go: agent's changes are committed incrementally by the agent itself
- Success verification: run a verification command defined in config or PRD (e.g., `npm test`)
- Push and PR creation via `@octokit/rest` (GitHub REST API) on success
- Draft PR creation with failure details via `@octokit/rest` on failure
- Post-run repo cleanup (reset working directory to watched branch, delete local working branch)
- Structured JSON logging to stdout/stderr (consumed by journald)
- Environment variable redaction in all log output
- Secrets stored as systemd credential files or environment variables (loaded from a protected file, not inline in the unit)
- Dockerfile + docker-compose for local testing
- Unit and integration tests

### Out-of-Scope (v1)

- Webhook-based triggers (polling only)
- Watching multiple repos or branches simultaneously
- Agent orchestration beyond a single OpenCode invocation per PRD
- PR review feedback loop (re-running agent based on PR comments)
- Any UI beyond CLI and systemd tooling

---

## Requirements

### PRD Format & Rendering (R1-R5)

- **R1:** The source of truth for a PRD is a JSON file conforming to the Scarlet PRD schema, placed in the configured `prd_directory` (default: `prds/`). Example filename: `prds/001-add-user-auth.json`. Markdown files (including this document) are documentation artifacts and are never consumed by Scarlet's PRD detector.

- **R2:** The PRD JSON schema is defined as follows:

  ```jsonc
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": [
      "id",
      "title",
      "description",
      "requirements",
      "acceptance_criteria",
    ],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
        "description": "Unique slug identifier, e.g. 'add-user-auth'. Used in branch names and PR titles.",
      },
      "title": {
        "type": "string",
        "minLength": 5,
        "maxLength": 120,
        "description": "Human-readable title.",
      },
      "description": {
        "type": "string",
        "minLength": 20,
        "description": "Context, problem statement, and motivation.",
      },
      "goals": {
        "type": "array",
        "items": { "type": "string" },
        "description": "High-level goals.",
      },
      "non_goals": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Explicitly excluded items.",
      },
      "requirements": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["id", "text"],
          "properties": {
            "id": { "type": "string", "pattern": "^R[0-9]+$" },
            "text": { "type": "string" },
          },
        },
        "minItems": 1,
        "description": "Functional requirements with stable IDs.",
      },
      "acceptance_criteria": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["id", "given", "when", "then"],
          "properties": {
            "id": { "type": "string", "pattern": "^AC-[0-9]+$" },
            "given": { "type": "string" },
            "when": { "type": "string" },
            "then": { "type": "string" },
          },
        },
        "minItems": 1,
        "description": "Testable acceptance criteria in Given/When/Then format.",
      },
      "verification_command": {
        "type": "string",
        "description": "Optional command to verify implementation (e.g. 'npm test'). Overrides global config if present.",
      },
      "technical_notes": {
        "type": "string",
        "description": "Optional implementation hints, constraints, or architecture notes for the agent.",
      },
      "files_to_modify": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional list of file paths the agent should focus on.",
      },
    },
    "additionalProperties": false,
  }
  ```

- **R3:** Scarlet validates each detected PRD JSON file against the schema (using ajv) before invoking the agent. If parsing or validation fails (including empty files and files larger than 1 MB), Scarlet does not invoke the agent and records failure reason `prd_validation_failed` (or `prd_file_too_large`). These failures follow the draft-PR flow in R31-R33, including creating an empty commit when needed so a branch can be pushed.

- **R4:** Scarlet includes a CLI sub-command `scarlet render <path-to-prd.json>` that:
  - Reads the JSON file.
  - Validates it against the PRD schema.
  - Outputs a human-readable markdown file to stdout (or to a file path if `--out <path>` is specified).
  - The rendered markdown includes: title as H1, description, goals as a bulleted list, non-goals, requirements table, acceptance criteria table (Given/When/Then columns), technical notes, and files to modify.
  - Exit code 0 on success, 1 on validation failure (with errors printed to stderr).

- **R5:** The render script can also be run in batch mode: `scarlet render --all <prds-directory>` which renders every `.json` file in the directory, writing corresponding `.md` files alongside them (e.g., `prds/001-add-auth.json` → `prds/001-add-auth.md`).

### Configuration (R6-R10)

- **R6:** Scarlet reads configuration from a YAML file at a path specified by the `SCARLET_CONFIG` environment variable, falling back to `/etc/scarlet/config.yaml`.

- **R7:** Configuration fields are split into required fields and optional fields with defaults. Required fields must be present in the YAML file. Optional fields may be omitted; Scarlet applies defaults during config load before startup validation completes.

  | Field                        | Type              | Required | Default               | Description                                                                                                                                     |
  | ---------------------------- | ----------------- | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | `repo.url`                   | string            | Yes      | _(none)_              | Git remote URL (SSH or HTTPS) of the target repo                                                                                                |
  | `repo.local_path`            | string            | Yes      | _(none)_              | Absolute path to the local clone directory                                                                                                      |
  | `repo.branch`                | string            | No       | `main`                | Branch to watch for new PRDs                                                                                                                    |
  | `repo.prd_directory`         | string            | No       | `prds`                | Directory within the repo containing PRD files                                                                                                  |
  | `poll_interval_seconds`      | integer           | No       | `30`                  | Seconds between polling cycles                                                                                                                  |
  | `agent.timeout_minutes`      | integer           | No       | `60`                  | Max wall-clock time for a single agent run before it is killed                                                                                 |
  | `agent.verification_command` | string (optional) | No       | _(none)_              | Global fallback command to verify success (e.g. `npm test`). Overridden by PRD-level `verification_command` if present.                      |
  | `git.committer_name`         | string            | No       | `scarlet-bot`         | Git committer name for agent commits                                                                                                            |
  | `git.committer_email`        | string            | No       | `scarlet-bot@noreply` | Git committer email for agent commits                                                                                                           |
  | `branch_prefix`              | string            | No       | `scarlet/`            | Prefix for working branches                                                                                                                     |
  | `github.owner`               | string            | Yes      | _(none)_              | GitHub repository owner (user or org)                                                                                                           |
  | `github.repo`                | string            | Yes      | _(none)_              | GitHub repository name                                                                                                                          |
  | `log_level`                  | string            | No       | `info`                | One of: `debug`, `info`, `warn`, `error`                                                                                                       |

- **R8:** Configuration is validated at startup using JSON Schema (ajv). If validation fails, Scarlet logs the specific validation errors and exits with code 1 within 2 seconds of launch.

- **R9:** Scarlet re-reads configuration only on restart (not hot-reloaded).

- **R10:** Sensitive values (`GITHUB_TOKEN`, `OPENCODE_API_KEY`, any env var whose name contains `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, or `CREDENTIAL`) must never appear in log output or PR bodies. Scarlet replaces their values with `[REDACTED]` before writing any output. The redaction function compiles a sensitive-value set from process environment variables at startup and applies key-name and token-pattern safety fallbacks during output serialization.

### Polling & PRD Detection (R11-R15)

- **R11:** On each poll cycle, Scarlet runs `git fetch origin <branch>` on the local clone directory. Scarlet allows only one active processing cycle at a time; if a cycle is already running, the next scheduled cycle is skipped with a `debug` log (`poll.skipped_in_progress`).

- **R12:** Scarlet compares `origin/<branch>` HEAD to the last-processed commit SHA, persisted at `<local_path>/.scarlet/state.json`. The objective of this state file is to provide durable resume behavior and enforce the one-time PRD processing policy.

  Canonical state shape:

  ```json
  {
    "version": 1,
    "last_commit": "<sha>",
    "pending_prds": [
      {
        "file": "prds/001-add-auth.json",
        "source_head": "<sha>",
        "detected_commit": "<sha>",
        "prd_id": "add-auth"
      }
    ],
    "interrupted_prd": {
      "file": "prds/001-add-auth.json",
      "source_head": "<sha>",
      "detected_commit": "<sha>",
      "prd_id": "add-auth",
      "branch": "scarlet/add-auth",
      "stage": "branch_ready"
    },
    "processed_prds": {
      "prds/001-add-auth.json": {
        "prd_id": "add-auth",
        "first_detected_commit": "<sha>",
        "source_head": "<sha>",
        "status": "in_progress"
      }
    }
  }
  ```

- **R13:** If new commits exist, Scarlet walks commits between the last-processed SHA and the new HEAD in chronological order and collects added or modified files matching `<prd_directory>/*.json`. Candidate files are de-duplicated by file path within the commit range using first-touch commit order (oldest first), with path-lexicographic tie-breakers.

- **R14:** Scarlet processes each PRD file path at most once unless state is explicitly reset. A PRD is eligible for queueing only if its path is not already present in `processed_prds`. On first queueing, Scarlet writes a `processed_prds[<file>]` entry with `status: "in_progress"` before processing starts.

- **R15:** `last_commit` is updated to the new HEAD only after the queued PRDs for that commit range finish processing (success or failure) and queue state is persisted. If interrupted, `last_commit` remains unchanged and `interrupted_prd`/`pending_prds` are used to resume. A commit range is never re-processed unless state is reset. If a previously seen PRD file is modified after work has begun, Scarlet ignores that file and logs `prd.ignored_already_processed`; corrective or superseding work must be expressed as a new PRD file (optionally a child/sub PRD).

### Agent Execution (R16-R23)

- **R16:** Scarlet creates a new local branch off `origin/<branch>` for every PRD processing attempt:
  - Valid PRD: `<branch_prefix><prd-id>`, where `<prd-id>` comes from the PRD JSON `id` field.
  - Invalid/unparseable/oversized PRD (no usable `id`): `<branch_prefix>invalid-<filename-stem>`.
  - If `<filename-stem>` is empty after sanitization, Scarlet uses `unknown-prd`.

- **R17:** If the branch already exists on the remote, Scarlet appends a 6-character random suffix (lowercase alphanumeric) to avoid conflicts. Example: `scarlet/add-auth-a3f9c1`.

- **R18:** Before invoking the agent, Scarlet renders the PRD JSON to a temporary markdown file at `<local_path>/.scarlet/current-prd.md` so the agent has a human-readable version. The JSON file path is also available.

- **R19:** Scarlet invokes the agent using the OpenCode CLI in non-interactive mode:

  ```
  opencode run --format json --file <local_path>/.scarlet/current-prd.md "<prompt>"
  ```

  Where `<prompt>` is a structured instruction string assembled by Scarlet containing:
  - A system preamble: `"Implement the following PRD. Make changes directly in this repository. Commit your work as you go with descriptive commit messages."`
  - The PRD title and id for context.
  - The list of acceptance criteria from the PRD JSON (so the agent can self-verify).
  - If `files_to_modify` is present in the PRD, a note: `"Focus on these files: <list>"`.
  - If `technical_notes` is present, it is appended verbatim.

  The full prompt template is defined as a constant in the codebase (not in config) so it can be versioned and tested.

- **R20:** Before invoking the agent, Scarlet sets repo-local git `user.name` and `user.email` from config (`git.committer_name`, `git.committer_email`). The agent process inherits Scarlet's environment variables (which includes `GITHUB_TOKEN`, `OPENCODE_API_KEY`, etc.) and runs with working directory set to `<local_path>` (the repo root).

- **R21:** Scarlet enforces the `agent.timeout_minutes` limit. If exceeded, the agent process is sent SIGTERM, then SIGKILL after 10 seconds if still running. This is logged as a timeout failure.

- **R22:** While the agent is running, Scarlet tails stdout and stderr and writes each line as structured `debug` logs (`message: "agent.output"`) with `context.stream` (`stdout` or `stderr`) and `context.line` (redacted per R10). Scarlet treats stdout as JSON event lines because `--format json` is enabled.

- **R23:** Scarlet captures the full stdout and stderr of the agent, storing raw lines in a ring buffer capped at 50 MB. If the buffer is exceeded, the oldest lines are dropped and a count of dropped lines is recorded.

### Verification (R24-R26)

- **R24:** After the agent exits, Scarlet determines the verification command using this precedence:
  1. `verification_command` field from the PRD JSON (if present and non-empty).
  2. `agent.verification_command` from the Scarlet config (if present and non-empty).
  3. No verification (skip, treat agent exit code as the sole success signal).

- **R25:** The verification command is executed as a shell command (`/bin/sh -c "<command>"`) in the repo working directory. Exit code 0 means verification passed; any other exit code means failure. Stdout and stderr are captured (capped at 10 MB).

- **R26:** The verification command has a separate timeout of 10 minutes (hardcoded for v1). If exceeded, it is killed and treated as a verification failure.

### Pushing & PR Creation (R27-R35)

- **R27:** After a successful agent run (agent exits 0 and verification passes, or no verification configured), Scarlet stages any unstaged changes, creates a final commit with message `scarlet: finalize <prd-id>`, and pushes the working branch to origin.

- **R28:** Scarlet uses `@octokit/rest` (initialized with `GITHUB_TOKEN`) for all GitHub API operations. The Octokit instance is created once at startup and reused.

- **R29:** On success, Scarlet creates a PR via `octokit.rest.pulls.create()` with:
  - **Title:** `[Scarlet] <prd.title>` (truncated to 256 characters)
  - **Head branch:** the working branch name
  - **Base branch:** the watched branch (e.g., `main`)
  - **Body:** Assembled from these sections (in order):
    1. **PRD Reference** — link to the PRD JSON file on the watched branch: `[<prd.id>](<github-url>/blob/<branch>/<prd_directory>/<filename>)`
    2. **Summary** — the PRD `description` field, truncated to 1,000 characters.
    3. **Acceptance Criteria** — rendered as a checklist from the PRD JSON (`- [ ] AC-01: Given... When... Then...`).
    4. **Verification Results** — stdout/stderr of the verification command (truncated to 30,000 characters), or "No verification command configured" if absent.
    5. **Commits** — list of each commit message on the working branch (from `git log origin/<branch>..HEAD --oneline`).
  - **PR body hard cap:** The final body is capped at 60,000 characters. GitHub API limits are higher (65,536), and Scarlet keeps a safety buffer to avoid hard-limit failures. If exceeded, Scarlet truncates oversized sections and appends a `[TRUNCATED]` notice.
  - **Draft:** `false`

- **R30:** After creating the PR, Scarlet adds labels `scarlet` and `automated` via `octokit.rest.issues.addLabels()`. If label creation fails (e.g., labels don't exist and repo permissions don't allow creation), Scarlet logs a `warn` and continues — the PR is still valid without labels.

- **R31:** On failure (`prd_validation_failed`, `prd_file_too_large`, `agent_exit_nonzero`, `agent_timeout`, or `verification_failed`), Scarlet still pushes whatever commits exist on the working branch and creates a **draft** PR via `octokit.rest.pulls.create()` with `draft: true`.

- **R32:** The draft PR body includes:
  - **Failure Summary** — stating the failure reason: one of `prd_validation_failed`, `prd_file_too_large`, `agent_exit_nonzero` (with exit code), `agent_timeout` (with configured timeout), or `verification_failed` (with exit code). Rendered as a clear heading + one-sentence description.
  - **Logs** — the last 200 lines of agent stdout/stderr (redacted per R10), inside a `<details>` collapse block.
  - **Verification Output** — verification command output (if applicable), truncated to 30,000 characters with `[TRUNCATED]` marker, inside a `<details>` collapse block.
  - **LLM Reasoning** — if the agent wrote any file matching `.scarlet/reasoning.md` in the working tree, its content is included verbatim.
  - **PRD Reference** — same link as the success case.
  - Labels: `scarlet`, `automated`, `failure`.

- **R33:** If a failure path would otherwise produce zero commits (including validation-only failures), Scarlet creates an empty commit (`scarlet: no agent output for <prd-ref>`) so the branch can be pushed and the draft PR can be created. `<prd-ref>` is `prd.id` when available, otherwise `invalid-<filename-stem>`.

- **R34:** If `octokit.rest.pulls.create()` fails due to transient conditions (e.g., network error, timeout, GitHub 5xx), Scarlet retries up to 3 times with exponential backoff (2s, 4s, 8s). If a 422 indicates body length issues, Scarlet rebuilds with stricter truncation and retries once. Other 422 validation errors are not retried. If all retries fail, Scarlet logs a `CRITICAL` level message with the branch name, the HTTP status code, and the error message, so the operator can manually create the PR from the pushed branch.

- **R35:** Scarlet pushes branches using `git push origin <branch-name>`. Authentication for push uses an SSH deploy key at `/var/lib/scarlet/.ssh/id_ed25519` (not a home-directory path). The `GITHUB_TOKEN` is used only for API operations (PR creation, labels). All git commands are executed with a 120-second timeout. If exceeded, the command is killed and the operation is retried once before being treated as a failure.

### Cleanup (R36-R38)

- **R36:** After PR creation (success or failure), Scarlet checks out the watched branch, runs `git reset --hard origin/<branch>`, deletes the local working branch, runs `git clean -fd -e .scarlet/`, and removes `<local_path>/.scarlet/current-prd.md`.

- **R37:** If cleanup fails (e.g., due to locked files), Scarlet logs a `warn`-level message and continues to the next poll cycle. The next cycle re-attempts cleanup before processing new PRDs.

- **R38:** Scarlet never deletes remote branches. Branch cleanup on the remote is the responsibility of the developer when merging/closing the PR.

### Systemd Integration (R39-R43)

- **R39:** Scarlet ships a systemd service unit file (`scarlet.service`) that:
  - Runs as a dedicated `scarlet` system user with no login shell and no home directory write access beyond the configured `local_path`.
  - Uses `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`, `PrivateTmp=yes`.
  - Sets `Restart=on-failure` with `RestartSec=10`.
  - Loads environment variables from `/etc/scarlet/env` (mode `0600`, owned by `root`).
  - Sets `StandardOutput=journal` and `StandardError=journal`.
  - Uses `ReadWritePaths=` to allowlist the configured `local_path`.
  - Uses `ReadOnlyPaths=/var/lib/scarlet/.ssh` for deploy-key access required by `git push`.

- **R40:** An install script (`install.sh`) performs the following:
  - Creates the `scarlet` system user (if not exists) with `/usr/sbin/nologin` shell.
  - Creates `/etc/scarlet/` directory (mode `0755`).
  - Creates `/var/lib/scarlet/.ssh` (mode `0700`, owned by `scarlet:scarlet`) for deploy keys.
  - Copies the config template to `/etc/scarlet/config.yaml` (mode `0644`) if it doesn't already exist.
  - Creates `/etc/scarlet/env` (mode `0600`, owned by root) with placeholder values for `GITHUB_TOKEN` and `OPENCODE_API_KEY`.
  - Copies the service unit file to `/etc/systemd/system/scarlet.service`.
  - Runs `systemctl daemon-reload`.
  - Prints instructions to: (a) edit config and env files, (b) set up SSH keys for the `scarlet` user, (c) run `systemctl enable --now scarlet`.

- **R41:** Scarlet handles `SIGTERM` gracefully: if an agent is running, it is sent SIGTERM, given 30 seconds to finish, then SIGKILL. The current PRD is marked as `interrupted` in the state file (it will be resumed on next start).

- **R42:** Scarlet handles `SIGINT` identically to `SIGTERM` (for interactive testing).

- **R43:** Scarlet logs a structured message at `info` level on startup (`scarlet.started`, with config hash and version) and on shutdown (`scarlet.stopped`, with reason: `signal`, `error`, or `config_invalid`).

### Logging (R44-R48)

- **R44:** All log output is structured JSON, one object per line (NDJSON), written to stdout.

- **R45:** Each log line includes: `timestamp` (ISO 8601 with milliseconds and UTC timezone), `level`, `message`, `component` (e.g., `poller`, `agent`, `git`, `cleanup`, `config`, `github`), and an optional `context` object with structured metadata.

- **R46:** Example log line:

  ```json
  {
    "timestamp": "2026-02-11T14:30:00.123Z",
    "level": "info",
    "component": "poller",
    "message": "New PRD detected",
    "context": { "prd": "add-user-auth", "commit": "a1b2c3d" }
  }
  ```

- **R47:** Scarlet scans every string value in every log line for known secret patterns (per R10) and replaces matches with `[REDACTED]` before writing. The scan operates on the final serialized JSON string as a safety net (not just on individual fields).

- **R48:** Log rotation is handled by journald (Scarlet does not manage log files directly). The install documentation notes recommended journald retention settings (`SystemMaxUse=500M`).

### Docker / Local Testing (R49-R51)

- **R49:** The repo includes a `Dockerfile` that builds a Ubuntu 22.04-based image with: Node.js 20 LTS, git, OpenCode CLI, and Scarlet itself. The `gh` CLI is NOT required (replaced by `@octokit/rest`).

- **R50:** The repo includes a `docker-compose.yaml` that:
  - Mounts a local directory as the repo clone path.
  - Passes `GITHUB_TOKEN` and `OPENCODE_API_KEY` from the host environment (or a `.env` file).
  - Exposes no ports (Scarlet has no network listener).

- **R51:** `package.json` scripts provide: `build` (TypeScript compilation), `test` (unit tests via `node --test`), `test:integration` (integration tests), `start` (run Scarlet), `render` (alias for `scarlet render`), `docker:build`, `docker:run`.

### Architecture Contracts (R52-R56)

- **R52:** Scarlet is implemented as explicit modules with stable interfaces: `config`, `state`, `poller`, `prd`, `agent`, `verification`, `git`, `github`, and `logging`.

- **R53:** Dependency direction is one-way: orchestrator -> modules/adapters. Adapters (`git`, `github`, `agent`) do not call each other directly.

- **R54:** Processing state transitions are explicit and persisted: `detected -> validated -> branch_ready -> agent_done -> verification_done -> pr_created -> cleaned`.

- **R55:** Queue and interruption recovery are durable: `pending_prds`, `interrupted_prd`, and `processed_prds` are written atomically before and after each transition.

- **R56:** PR bodies (success and failure) share the same hard cap and truncation policy so deterministic validation errors do not trigger blind retries.

### CLI Surface (R57-R59)

- **R57:** Scarlet exposes the following CLI commands:

  | Command | Purpose | Options / Arguments | Exit Codes |
  | ------- | ------- | ------------------- | ---------- |
  | `scarlet start` | Run the daemon polling loop. | No command-specific options in v1. Reads config via `SCARLET_CONFIG` fallback rules (R6). | `0` on graceful shutdown, `1` on startup/config failure. |
  | `scarlet render <path-to-prd.json>` | Validate and render one PRD JSON to markdown. | Optional `--out <path>` writes to file; default writes to stdout. | `0` on success, `1` on validation/read failure. |
  | `scarlet render --all <prds-directory>` | Batch-render all PRD JSON files in a directory to sibling `.md` files. | `--all <prds-directory>` | `0` when all files render successfully, `1` if any file fails. |

- **R58:** `scarlet start` exits with code 1 if config loading/validation fails, including missing config file, YAML parse errors, or schema violations. For service stop via signal (`SIGTERM`/`SIGINT`) after startup, Scarlet exits with code 0.

- **R59:** `scarlet render` and `scarlet render --all` are deterministic pure CLI operations: they never mutate git state, never invoke the agent, and only read PRD JSON + write markdown output.

---

## Acceptance Criteria

### PRD Format & Rendering

- **AC-01:** Given a valid PRD JSON file with all required fields, when `scarlet render prds/001-add-auth.json` is run, then a markdown document is written to stdout containing the title as H1, a description section, requirements as a table, and acceptance criteria as a table with Given/When/Then columns, and the exit code is 0.

- **AC-02:** Given a PRD JSON file missing the required `acceptance_criteria` field, when `scarlet render` is run, then stderr contains the validation error `must have required property 'acceptance_criteria'` and exit code is 1.

- **AC-03:** Given `scarlet render --all prds/` with 3 JSON files in the directory, when the command completes, then 3 corresponding `.md` files exist alongside the JSON files.

### Configuration

- **AC-04:** Given a valid YAML config file and `SCARLET_CONFIG` pointing to it, when Scarlet starts, then it logs `scarlet.started` with the config hash and begins polling within `poll_interval_seconds`.

- **AC-05:** Given a config file missing the required `repo.url` field, when Scarlet starts, then it logs a validation error naming the missing field and exits with code 1 within 2 seconds.

- **AC-06:** Given `SCARLET_CONFIG` is not set and `/etc/scarlet/config.yaml` does not exist, when Scarlet starts, then it logs `config file not found at /etc/scarlet/config.yaml` and exits with code 1.

- **AC-07:** Given `GITHUB_TOKEN=ghp_abc123def456` in the environment and a log message that would include this value, when the log is written, then the output contains `[REDACTED]` instead of `ghp_abc123def456`.

### Polling & Detection

- **AC-08:** Given a target repo with no new commits since the last-processed SHA, when a poll cycle runs, then no agent is invoked and a `debug`-level log `No new commits` is emitted.

- **AC-09:** Given a new commit on the watched branch that adds `prds/001-add-auth.json`, when the poll cycle runs, then Scarlet validates the JSON, identifies `add-auth` as a new PRD (from the `id` field), and begins processing it.

- **AC-10:** Given a new commit that modifies `README.md` but does not add or modify any `.json` file in `prds/`, when the poll cycle runs, then no PRD processing is triggered.

- **AC-11:** Given two new PRDs (`prds/001-feature-a.json` and `prds/002-feature-b.json`) in commits C1 (older) and C2 (newer), when the poll cycle runs, then `feature-a` is processed first (completed or failed) before `feature-b` processing begins.

- **AC-12:** Given a new `.json` file in `prds/` that fails schema validation (e.g., missing `requirements`), when the poll cycle processes it, then no agent is invoked, a draft PR is created with the validation errors in the body, and the PRD is logged as skipped.

- **AC-13:** Given a poll interval elapses while Scarlet is already processing a PRD, when the next cycle trigger occurs, then Scarlet does not start a second cycle and emits `poll.skipped_in_progress` at `debug` level.

### Agent Execution

- **AC-14:** Given a valid PRD with `id: "add-auth"`, when agent processing begins, then a local branch `scarlet/add-auth` is created from `origin/<branch>` HEAD.

- **AC-15:** Given a remote branch `scarlet/add-auth` already exists, when Scarlet creates the working branch, then the branch name has a 6-character alphanumeric suffix appended (e.g., `scarlet/add-auth-x7k2m9`).

- **AC-40:** Given processing starts for `prds/007-bad-prd.json` and the PRD cannot be parsed/validated for an `id`, when Scarlet creates the working branch, then the branch uses the fallback form `scarlet/invalid-007-bad-prd` (with suffix if needed per AC-15).

- **AC-16:** Given `agent.timeout_minutes` is set to 1 and the agent process runs for 90 seconds, when the timeout is reached, then the agent receives SIGTERM, followed by SIGKILL after 10 seconds if still alive, and the run is recorded as a timeout failure.

- **AC-17:** Given the agent exits with code 0 and no verification command is configured (neither PRD-level nor config-level), when post-agent processing runs, then the result is treated as success.

- **AC-18:** Given the agent exits with code 0 and the PRD JSON has `"verification_command": "npm test"`, when `npm test` exits with code 1, then the result is treated as failure (even though the agent succeeded).

- **AC-19:** Given a PRD with `"verification_command": "npm test"` and a config with `agent.verification_command: "make check"`, when verification runs, then `npm test` is used (PRD-level takes precedence).

### PR Creation

- **AC-20:** Given a successful agent run, when Scarlet creates the PR via the GitHub API, then the PR is non-draft, has base branch = watched branch, title is `[Scarlet] <prd.title>`, body contains a link to the PRD JSON file, acceptance criteria as a checklist, and verification output, and labels include `scarlet` and `automated`.

- **AC-21:** Given a failed agent run (exit code 1), when Scarlet creates the draft PR via the GitHub API, then the PR is a draft, body contains a "Failure Summary" section with the exit code, a "Logs" section with the last 200 lines of redacted agent output inside a `<details>` block, and labels include `failure`.

- **AC-22:** Given `octokit.rest.pulls.create()` returns a 500 error 3 times consecutively, when all retries are exhausted, then a `CRITICAL` log is emitted containing the working branch name and the HTTP status code.

- **AC-23:** Given a failed agent run where the agent wrote `.scarlet/reasoning.md` in the working tree, when the draft PR is created, then the PR body contains an "LLM Reasoning" section with that file's content.

- **AC-24:** Given the agent produced zero commits, when Scarlet creates the draft PR, then an empty commit exists on the branch (so the PR can be created), and the body contains "Agent produced no commits."

- **AC-25:** Given a failure path where `octokit.rest.pulls.create()` initially returns 422 due to body size, when Scarlet retries, then it truncates the body, marks it `[TRUNCATED]`, and creates the PR successfully.

- **AC-26:** Given a PRD JSON file larger than 1 MB, when processed, then Scarlet does not invoke the agent, creates a draft PR with reason `prd_file_too_large`, and pushes a branch with an empty commit if no commits existed.

- **AC-41:** Given `octokit.rest.pulls.create()` returns a 422 validation error that is not a body-length issue, when Scarlet handles the failure, then it does not retry the same request and records the failure immediately.

### Cleanup

- **AC-27:** Given a PR was successfully created, when cleanup runs, then the local working branch is deleted, the working directory is on the watched branch, `git status` shows a clean tree (excluding `.scarlet/` state artifacts), and `.scarlet/current-prd.md` does not exist.

- **AC-28:** Given cleanup fails due to a git lock file, when the next poll cycle begins, then cleanup is re-attempted before any new PRD processing.

### Systemd

- **AC-29:** Given Scarlet is installed via `install.sh` on Ubuntu 22.04, when `systemctl start scarlet` is run, then the process starts as the `scarlet` user, and `systemctl status scarlet` shows `active (running)`.

- **AC-30:** Given Scarlet is running and receives SIGTERM while `pending_prds` is non-empty, when shutdown occurs, then the active agent is terminated within 30 seconds, the current PRD is saved as `interrupted_prd`, `last_commit` is unchanged, and Scarlet exits with code 0.

- **AC-31:** Given Scarlet crashes (exits non-zero), when systemd detects the failure, then Scarlet is restarted after 10 seconds.

- **AC-32:** Given Scarlet restarts with a non-null `interrupted_prd`, when startup completes, then Scarlet resumes that PRD before processing any newer commit range.

### Security

- **AC-33:** Given Scarlet is running as the `scarlet` user, when it attempts to write to `/etc/passwd`, then the write is denied (verifying systemd sandboxing and least-privilege).

- **AC-34:** Given the env file `/etc/scarlet/env` exists with mode `0600` owned by root, when the `scarlet` user process starts via systemd, then it can access the environment variables loaded by systemd's `EnvironmentFile` directive (systemd reads the file as root before dropping privileges to the `scarlet` user).
  *✅ Validated against systemd 249 source code - see "Systemd Security Directives Research" section for evidence.*

### Docker

- **AC-35:** Given the `Dockerfile` and `docker-compose.yaml`, when `docker compose up` is run with valid env vars and a mounted repo directory, then Scarlet starts polling and structured JSON logs are visible via `docker compose logs`.

### State & CLI

- **AC-36:** Given `prds/001-add-auth.json` has already been queued or processed once, when a later commit modifies that same file path, then Scarlet does not queue it again, logs `prd.ignored_already_processed`, and continues processing other eligible PRDs.

- **AC-37:** Given a missing or corrupt `state.json`, when Scarlet starts, then it initializes state with `version`, `last_commit` set to current `origin/<branch>` HEAD, and empty `pending_prds`/`interrupted_prd`/`processed_prds`, logs a `warn`, and processes no historical PRDs.

- **AC-38:** Given startup fails because config file is missing or invalid, when `scarlet start` exits, then the exit code is 1; given Scarlet receives `SIGTERM` or `SIGINT` after startup, then it exits with code 0 after graceful shutdown behavior.

- **AC-39:** Given `scarlet render --all prds/` and one JSON file fails validation, when the command finishes, then it exits with code 1 and prints validation details for the failing file(s) to stderr.

---

## UX / UI Notes

### Information Architecture

Scarlet has no graphical UI. The "interface" is:

1. **Configuration:** `/etc/scarlet/config.yaml` (YAML file, validated at startup).
2. **CLI sub-commands:** `scarlet start` (main daemon), `scarlet render` (PRD JSON → markdown).
3. **Status:** `systemctl status scarlet` and `journalctl -u scarlet -f`.
4. **Output:** GitHub Pull Requests on the target repository.
5. **State:** `<local_path>/.scarlet/state.json` (internal, not user-editable under normal operation).

### Loading / Empty / Error States

| State                                                                                 | Behavior                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No PRDs ever detected**                                                             | Scarlet logs `No new commits` at `debug` level each poll cycle. No PRs created.                                                                                 |
| **State file missing/corrupt**                                                        | Scarlet treats the current HEAD of the watched branch as the starting point (processes no historical PRDs). Logs a `warn` that state was initialized from HEAD. |
| **State file references a commit that is no longer an ancestor of HEAD (force-push)** | Scarlet logs a `warn`, resets state to current HEAD, and continues. No historical PRDs are re-processed.                                                        |
| **Target repo not cloned yet (`local_path` does not exist or is empty)**              | Scarlet performs an initial `git clone` to `local_path` on first run. If clone fails, Scarlet exits with code 1 and logs the error.                             |
| **`local_path` exists but is not a git repo**                                         | Scarlet logs an `error` (`local_path exists but is not a git repository`) and exits with code 1.                                                                |
| **Network unavailable during poll**                                                   | `git fetch` fails. Scarlet logs a `warn` and retries on the next poll cycle. No crash.                                                                          |
| **Agent produces no commits**                                                         | Treated as a failure. An empty commit is created so the branch can be pushed. Draft PR is created with a note "Agent produced no commits."                      |
| **PRD JSON file is empty (0 bytes)**                                                  | Scarlet logs a `warn`, does not invoke the agent, and creates a validation-failure draft PR.                                                                    |
| **PRD JSON file fails schema validation**                                             | Scarlet logs a `warn` with validation errors, creates a draft PR with the errors (no agent invocation), and advances past it.                                   |
| **PRD JSON file exceeds 1 MB**                                                        | Scarlet logs a `warn` (`prd_file_too_large`), does not invoke the agent, and creates a draft PR describing the size failure.                                    |
| **Previously seen PRD file is modified later**                                        | Scarlet logs `prd.ignored_already_processed`, ignores the modified file, and requires a new PRD file for corrective/superseding work.                            |

### Validation Rules

- Config YAML must parse without errors. Schema violations produce human-readable messages referencing the field path (e.g., `repo.url is required`).
- Required config fields are: `repo.url`, `repo.local_path`, `github.owner`, `github.repo`. All other fields are optional with defaults defined in R7.
- `poll_interval_seconds` must be >= 10 (to avoid hammering the remote) and <= 3600 (1 hour).
- `agent.timeout_minutes` must be >= 1 and <= 480 (8 hours).
- `repo.local_path` must be an absolute path (starts with `/`).
- `github.owner` and `github.repo` must be non-empty strings matching `^[a-zA-Z0-9_.-]+$`.
- PRD JSON files must conform to the schema defined in R2.

---

## Data, Integrations, and Permissions

### Data Inputs/Outputs

| Data                  | Direction    | Format                                                               | Location                                        |
| --------------------- | ------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| Scarlet config        | Input        | YAML                                                                 | `/etc/scarlet/config.yaml` or `$SCARLET_CONFIG` |
| Environment secrets   | Input        | Key=Value (shell format)                                             | `/etc/scarlet/env`                              |
| PRD files             | Input        | JSON (schema-validated)                                              | `<repo>/<prd_directory>/*.json`                 |
| Rendered PRDs         | Output (CLI) | Markdown                                                             | stdout or `.md` file next to JSON source        |
| Current PRD for agent | Internal     | Markdown (rendered from JSON)                                        | `<local_path>/.scarlet/current-prd.md`          |
| State file            | Internal     | JSON (`{"version":1,"last_commit":"<sha>","pending_prds":[{"file":"<path>","source_head":"<sha>","detected_commit":"<sha>","prd_id":"<id>"}],"interrupted_prd":{"file":"<path>","source_head":"<sha>","detected_commit":"<sha>","prd_id":"<id>","branch":"<branch>","stage":"<stage>"} \| null,"processed_prds":{"<path>":{"prd_id":"<id>","first_detected_commit":"<sha>","source_head":"<sha>","status":"<status>"}}}`) | `<local_path>/.scarlet/state.json`              |
| Agent logs            | Internal     | Text (stdout/stderr capture)                                         | In-memory ring buffer, flushed to PR body       |
| Pull Requests         | Output       | GitHub PR (via `@octokit/rest`)                                      | Target repo on GitHub                           |
| Structured logs       | Output       | NDJSON                                                               | stdout → journald                               |

### External Dependencies

| Dependency            | Required Version | Purpose                                                 |
| --------------------- | ---------------- | ------------------------------------------------------- |
| Node.js               | >= 20 LTS        | Scarlet runtime                                         |
| git                   | >= 2.30          | Repo operations (fetch, checkout, branch, commit, push) |
| `@octokit/rest`       | latest           | GitHub REST API client (PR creation, label management)  |
| `ajv` + `ajv-formats` | latest           | JSON Schema validation (config + PRD)                   |
| OpenCode CLI          | latest           | Coding agent (`opencode run`)                           |
| systemd               | >= 249           | Service management (Ubuntu 22.04 ships 249)             |

### Roles/Permissions

| Context               | Permission                                                    | Notes                                                                                                                          |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `scarlet` system user | Read/write to `repo.local_path` only                          | No login shell (`/usr/sbin/nologin`); writable paths are explicitly allowlisted by systemd.                                    |
| `scarlet` system user | Read access to `/var/lib/scarlet/.ssh/` deploy key           | Used for `git push` over SSH. Key pair generated during install, public key added to GitHub as a deploy key with write access. |
| `GITHUB_TOKEN`        | Scopes: `repo`, `pull_request:write`                          | Used only by `@octokit/rest` for API calls (PRs, labels). Not used for git push.                                               |
| `OPENCODE_API_KEY`    | Per OpenCode's requirements                                   | Passed through to agent subprocess environment                                                                                 |
| Filesystem            | `ProtectSystem=strict` blocks writes outside `ReadWritePaths` | systemd sandboxing                                                                                                             |

### Auth Separation

Git push (SSH key) and GitHub API (`GITHUB_TOKEN`) use **separate credentials**. This allows finer-grained permission control:

- The SSH deploy key can be scoped to a single repo.
- The `GITHUB_TOKEN` can be a fine-grained personal access token scoped to the target repo with only "Pull Requests: Write" and "Contents: Write" permissions.

---

## Metrics & Telemetry

All metrics are emitted as structured log events (queryable via `journalctl` + `jq`). No external telemetry system in v1.

### Success Metrics

| Metric                   | Type    | Target                                        |
| ------------------------ | ------- | --------------------------------------------- |
| PRD-to-PR cycle time     | Leading | < `agent.timeout_minutes` for successful runs |
| PRD success rate         | Lagging | Track over time (no target for v1)            |
| Agent timeout rate       | Lagging | < 20% of runs                                 |
| PR creation failure rate | Lagging | < 5% of attempts                              |

### Events to Capture

| Event Name               | Level    | Properties                                                          |
| ------------------------ | -------- | ------------------------------------------------------------------- |
| `scarlet.started`        | info     | `version`, `config_hash`                                            |
| `scarlet.stopped`        | info     | `reason` (`signal`, `error`, `config_invalid`)                      |
| `poll.cycle`             | debug    | `last_commit`, `new_commit`, `new_prds_count`                       |
| `poll.skipped_in_progress` | debug  | `last_commit`, `reason` (`processing_active`)                        |
| `prd.detected`           | info     | `prd_id`, `prd_file`, `commit_sha`                                  |
| `prd.validation_failed`  | warn     | `prd_file`, `errors` (array of validation error strings)            |
| `prd.skipped`            | warn     | `prd_id`, `reason` (`empty`, `invalid_schema`, `file_too_large`, `already_processed`) |
| `prd.ignored_already_processed` | info | `prd_file`, `first_detected_commit`, `latest_commit`                |
| `prd.rendered`           | debug    | `prd_id`, `output_path`                                             |
| `agent.started`          | info     | `prd_id`, `branch`, `command`                                       |
| `agent.completed`        | info     | `prd_id`, `exit_code`, `duration_seconds`, `commit_count`           |
| `agent.timeout`          | error    | `prd_id`, `timeout_minutes`                                         |
| `verification.started`   | info     | `prd_id`, `command`, `source` (`prd` or `config`)                   |
| `verification.completed` | info     | `prd_id`, `exit_code`, `duration_seconds`                           |
| `verification.timeout`   | error    | `prd_id`, `timeout_seconds`                                         |
| `git.push`               | info     | `branch`, `duration_seconds`                                        |
| `git.push_failed`        | error    | `branch`, `error_message`                                           |
| `pr.created`             | info     | `prd_id`, `pr_number`, `pr_url`, `draft`                            |
| `pr.create_failed`       | error    | `prd_id`, `attempt`, `http_status`, `error_message`                 |
| `pr.create_exhausted`    | critical | `prd_id`, `branch`, `attempts`                                      |
| `cleanup.completed`      | info     | `prd_id`                                                            |
| `cleanup.failed`         | warn     | `prd_id`, `error_message`                                           |

---

## Rollout & Operations

### Staged Rollout Plan

1. **Phase 1 — Docker-only testing:** Build and run in Docker container. Use a test repo with synthetic PRDs. Validate all ACs against the container using OpenCode.
2. **Phase 2 — Physical machine dry-run:** Install on the target Ubuntu machine. Configure with a test repo (not production). Run for 48+ hours. Verify log output, PR creation, cleanup, and restart behavior.
3. **Phase 3 — Production:** Point at the real target repo. Monitor first 5 PRDs manually.

### Migration/Backfill Needs

- None. Greenfield project. On first run, Scarlet initializes its state file to the current HEAD (no historical PRDs are processed).

### Monitoring Signals (What to Watch)

| Signal                     | How to Observe                                                                    | Action Threshold                        |
| -------------------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| Service health             | `systemctl is-active scarlet`                                                     | Alert if `inactive` or `failed`         |
| Repeated restart loops     | `systemctl show scarlet -p NRestarts`                                             | Alert if > 3 restarts in 10 minutes     |
| Agent timeout rate         | `journalctl -u scarlet --output=json \| jq 'select(.message == "agent.timeout")'` | Investigate if > 2 consecutive timeouts |
| PR creation failures       | `journalctl -u scarlet --output=json \| jq 'select(.level == "critical")'`        | Immediate investigation                 |
| Disk usage at `local_path` | Standard disk monitoring                                                          | Alert if partition > 90% full           |

### Rollback Approach

- Scarlet is stateless except for `state.json`. To rollback: `systemctl stop scarlet`, install the previous version, `systemctl start scarlet`.
- If a bad state file causes issues, delete `<local_path>/.scarlet/state.json` and restart. Scarlet will re-initialize to current HEAD.
- If a working branch was left behind, it can be deleted manually (`git branch -D <branch>`).

---

## Risks

- **RISK-01: Agent produces broken code that passes verification.** _Mitigation:_ Human always reviews the PR before merging. PRDs should include comprehensive acceptance criteria. This is acceptable for v1.

- **RISK-02: OpenCode CLI interface changes (breaking update).** _Mitigation:_ Pin OpenCode version in Dockerfile and document the expected CLI contract (`opencode run` with `--file` flag).

- **RISK-03: `GITHUB_TOKEN` or `OPENCODE_API_KEY` leaked in agent output.** _Mitigation:_ R10 redaction applies to all log lines and PR bodies. Agent subprocess inherits env vars but Scarlet sanitizes captured output before persisting anywhere.

- **RISK-04: Agent modifies files outside the repo (escape).** _Mitigation:_ The `scarlet` user has write access only to `local_path`. systemd `ProtectSystem=strict` and `ProtectHome=yes` block writes elsewhere. For stronger isolation, run Scarlet inside a container.

- **RISK-05: Polling at high frequency causes GitHub rate limiting.** _Mitigation:_ Minimum poll interval is 10 seconds (enforced by config validation). Default is 30 seconds. `git fetch` uses SSH (not API), so GitHub API rate limits are unrelated. The API is only called when creating PRs and labels — well within rate limits.

- **RISK-06: Large PRDs or agent output exceeds memory.** _Mitigation:_ Agent output capture uses a ring buffer capped at 50 MB (R23). PR body log sections are truncated (R29, R32). PRD JSON files larger than 1 MB are skipped with a warning.

- **RISK-07: `@octokit/rest` API version deprecation.** _Mitigation:_ Pin `@octokit/rest` in `package.json`. GitHub REST API v3 is stable with long deprecation windows. Update on a scheduled cadence.

---

---

## Systemd Security Directives Research

This section documents the behavior of systemd security directives used in the Scarlet service unit file, validated against systemd 249 (Ubuntu 22.04). All claims are supported by source code references to the systemd codebase.

### AC-34 Validation: EnvironmentFile Behavior

**Status:** ✅ **CORRECT**

**Claim:** systemd reads environment files as root before dropping privileges to the service user.

**Evidence** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L498)):
```c
// execute.c:498 - Environment loaded BEFORE privilege drop
r = exec_context_load_environment(unit, context, &params->files_env);
```

**Evidence** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L901-L938)):
```c
// execute.c:901-938 - load_env_file(NULL, *path, &p) reads as root
// NULL first parameter means use current user (root)
```

**Evidence** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/exec-invoke.c#L1074)):
```c
// exec-invoke.c:1074 - Privilege drop occurs LATER
if (setresuid(uid, uid, uid) < 0)
    return -errno;
```

**Execution Flow:**
1. Parent (systemd, running as root) → `exec_spawn()` → line 498: Load environment files
2. Files read with `load_env_file(NULL, *path, &p)` (as root)
3. Environment stored in `params->files_env`
4. Child spawned → `exec_invoke()` → `enforce_user()` → line 1074: `setresuid()` drops privileges
5. Service runs as specified user with pre-loaded environment variables

**Requirements:**
- Environment file must be readable by root (mode `0600` owned by `root` is sufficient)
- Supports globbing in file paths
- Supports graceful failure with `-` prefix (file not found is not fatal)

### Security Directives Behavior

#### ProtectSystem=strict

**Behavior:** Mounts the entire filesystem read-only, except for `/dev`, `/proc`, and `/sys`. All other directories are read-only.

**Evidence:** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L3225-L3245))

**Impact on Scarlet:**
- Prevents accidental writes to system directories (`/etc`, `/usr`, `/var`, etc.)
- `ReadWritePaths` directive is required to allow writes to `repo.local_path`
- Provides strong defense-in-depth against compromised agent code

#### ProtectHome=yes

**Behavior:** Makes home directories inaccessible. The service cannot read or write to any user's home directory.

**Evidence:** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L3247-L3267))

**Impact on Scarlet:**
- The `scarlet` system user has no home directory write access
- Prevents access to `/home/*` and `/root`
- Consistent with least-privilege principle

#### ReadWritePaths

**Behavior:** Explicitly allowlists writable paths. All other paths remain read-only (when combined with `ProtectSystem=strict`).

**Evidence:** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L3269-L3295))

**Impact on Scarlet:**
- Required to allow writes to `repo.local_path`
- Must be configured dynamically based on the `repo.local_path` setting
- Only the specified path is writable; all other paths remain read-only

#### ReadOnlyPaths

**Behavior:** Explicitly marks paths as read-only, even if they would otherwise be writable.

**Evidence:** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L3297-L3323))

**Impact on Scarlet:**
- Used for `/var/lib/scarlet/.ssh` to ensure deploy keys cannot be modified
- Provides defense-in-depth: even if the `scarlet` user had write permissions, systemd blocks writes
- Critical for preventing SSH key tampering

#### NoNewPrivileges=yes

**Behavior:** Sets the `NO_NEW_PRIVS` flag for the process, preventing it from gaining new privileges (e.g., via `setuid` binaries, file capabilities).

**Evidence:** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L3325-L3345))

**Impact on Scarlet:**
- Prevents the agent from escalating privileges even if it executes privileged binaries
- Critical for containing potential vulnerabilities in the agent or its dependencies
- Works in conjunction with user-level restrictions

#### PrivateTmp=yes

**Behavior:** Provides a private `/tmp` directory for the service. The service cannot see other services' temporary files, and vice versa.

**Evidence:** ([systemd source](https://github.com/systemd/systemd/blob/83b4a5bb3d6a0f565aebcba975efad8dac73abea/src/core/execute.c#L3347-L3375))

**Impact on Scarlet:**
- Isolates temporary files from other services
- Prevents information leakage via `/tmp`
- Automatically cleaned up when the service stops

### Directive Interaction Analysis

The security directives work together to provide layered protection:

1. **ProtectSystem=strict** establishes a read-only baseline
2. **ReadWritePaths** carves out the minimal writable area (`repo.local_path`)
3. **ReadOnlyPaths** ensures critical paths (SSH keys) remain read-only
4. **ProtectHome=yes** removes access to user home directories
5. **NoNewPrivileges=yes** prevents privilege escalation
6. **PrivateTmp=yes** isolates temporary files

**Order of operations (systemd applies these in sequence):**
1. Mount namespaces are created
2. `ProtectSystem` applies read-only mounts
3. `ProtectHome` applies home directory restrictions
4. `ReadWritePaths` applies writable mounts
5. `ReadOnlyPaths` applies read-only mounts (can override `ReadWritePaths`)
6. `PrivateTmp` creates private `/tmp`
7. `NoNewPrivileges` sets the process flag
8. User/privilege drop occurs (after environment files are loaded)

### Recommendations for PRD

1. **AC-34 is correct as written** - No changes needed to the acceptance criteria.

2. **Install script should validate systemd version** - The install script should check that systemd >= 249 is available (Ubuntu 22.04+). Earlier versions may have different behavior for these directives.

3. **Service unit file should be generated dynamically** - The `ReadWritePaths` directive must be set to the configured `repo.local_path`. The install script or a template system should handle this.

4. **Documentation should note the layered security model** - The combination of directives provides defense-in-depth. No single directive is sufficient on its own.

5. **Testing should verify each directive** - Integration tests should verify that:
   - Writes to `/etc` are blocked (ProtectSystem=strict)
   - Writes to `/home` are blocked (ProtectHome=yes)
   - Writes to `repo.local_path` succeed (ReadWritePaths)
   - Writes to `/var/lib/scarlet/.ssh` are blocked (ReadOnlyPaths)
   - Privilege escalation is prevented (NoNewPrivileges=yes)
   - `/tmp` is isolated (PrivateTmp=yes)

### References

- systemd source code (commit `83b4a5bb3d6a0f565aebcba975efad8dac73abea`): https://github.com/systemd/systemd
- Linux Audit - ProtectSystem: https://linux-audit.com/systemd/settings/units/protectsystem/
- Linux Audit - ProtectHome: https://linux-audit.com/systemd/settings/units/protecthome/
- Linux Audit - ReadWritePaths: https://linux-audit.com/systemd/settings/units/readwritepaths/
- Linux Audit - ReadOnlyPaths: https://linux-audit.com/systemd/settings/units/readonlypaths/
- Ubuntu Jammy manpages: https://manpages.ubuntu.com/manpages/jammy/man5/systemd.exec.5.html
- ArchWiki Sandboxing: https://wiki.archlinux.org/title/Systemd/Sandboxing


## Resolved Decisions

All open questions from the design phase have been resolved. Decisions are codified directly in the requirements they affect.

| #   | Decision                        | Resolution                                                                                         | Requirement               |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| Q1  | SSH vs HTTPS for git push       | **SSH-only** via deploy key on the `scarlet` user. HTTPS deferred.                                 | R35                       |
| Q2  | Force-push handling             | **Reset state to current HEAD**, log `warn`, continue. No historical PRDs re-processed.            | UX table (force-push row) |
| Q3  | `scarlet render` packaging      | **Sub-command** of the main `scarlet` binary. One install, one binary.                             | R4, R5                    |
| Q4  | PRD schema strictness           | **Strict** (`additionalProperties: false`). Prevents silent typos. Can be relaxed later.           | R2                        |
| Q5  | Auto-clone vs pre-clone         | **Auto-clone** on first run if `local_path` doesn't exist. Use as-is if it's already a valid repo. | UX table (not cloned row) |
| Q6  | Prompt template configurability | **Hardcoded** as a versioned constant in source code. Tested and deterministic.                    | R19                       |
| Q7  | PRD file reprocessing policy    | **Process each PRD file path once.** Later edits to the same file are ignored; use a new PRD file for superseding work. | R14, R15, AC-36          |
| Q8  | Config required vs defaults     | **Explicit required fields + defaults**. Only core repo/github identifiers are required in YAML; others defaulted. | R7                         |
| Q9  | OpenCode output mode            | **Structured output** via `opencode run --format json` to improve deterministic logging/parsing.     | R19, R22                  |
| Q10 | PR 422 retry behavior           | **Retry only body-length 422 once after truncation**; do not retry other 422 validation errors.     | R34                        |

---

## Glossary

| Term                     | Definition                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PRD**                  | Product Requirements Document. A JSON file (`.json`) conforming to the Scarlet PRD schema, placed in the configured `prd_directory` of the target repo. Describes a feature for the agent to implement.                 |
| **PRD schema**           | The JSON Schema that defines the required and optional fields for a PRD file. See R2.                                                                                                                                   |
| **Rendered PRD**         | A human-readable markdown file generated from a PRD JSON file by `scarlet render`. Not the source of truth — the JSON file is.                                                                                          |
| **Target repo**          | The GitHub repository that Scarlet watches for new PRDs and pushes implementation branches to. Scarlet itself lives in a separate repo.                                                                                 |
| **Watched branch**       | The branch on the target repo that Scarlet polls for new PRD commits (default: `main`).                                                                                                                                 |
| **Working branch**       | A temporary local+remote branch created by Scarlet for implementation work. Named `<branch_prefix><prd-id>` for valid PRDs, or `<branch_prefix>invalid-<filename-stem>` when no usable PRD id is available.          |
| **PRD id**               | The `id` field from the PRD JSON. A lowercase kebab-case slug (e.g., `add-user-auth`). Used in branch names, log messages, and PR titles.                                                                               |
| **PRD slug**             | Synonym for PRD id.                                                                                                                                                                                                     |
| **Agent**                | The AI coding tool (OpenCode in v1) invoked as a subprocess to implement the PRD.                                                                                                                                       |
| **OpenCode**             | An open-source, provider-agnostic AI coding agent with a TUI and non-interactive CLI mode (`opencode run`). See [opencode.ai](https://opencode.ai).                                                                     |
| **`opencode run`**       | The non-interactive CLI mode of OpenCode. Scarlet uses `--format json` for structured output and `--file` attachments for the rendered PRD context. Does not launch the TUI.                                          |
| **Verification command** | A shell command (e.g., `npm test`) run after the agent finishes to confirm the implementation meets acceptance criteria. Can be specified per-PRD (in the JSON) or globally (in Scarlet config). Success = exit code 0. |
| **State file**           | A JSON file at `<local_path>/.scarlet/state.json` that tracks `last_commit`, queued `pending_prds`, `interrupted_prd`, and `processed_prds` to provide durable resume and one-time PRD processing semantics.          |
| **Draft PR**             | A GitHub pull request created in draft state, indicating it is not ready for merge. Used by Scarlet to surface failures and validation errors.                                                                          |
| **Redaction**            | The process of replacing sensitive values (tokens, keys, passwords) with `[REDACTED]` in log output and PR bodies before they are written or sent.                                                                      |
| **Ring buffer**          | A fixed-size buffer that overwrites the oldest entries when full. Used by Scarlet to cap agent output capture at 50 MB.                                                                                                 |
| **NDJSON**               | Newline-Delimited JSON. Each line of output is a complete, self-contained JSON object. Scarlet's log format.                                                                                                            |
| **`@octokit/rest`**      | The official GitHub REST API client for JavaScript/TypeScript. Used by Scarlet for PR creation and label management.                                                                                                    |
| **Deploy key**           | An SSH key associated with a single GitHub repository (not a user account). Grants push access to that repo only. Used by the `scarlet` system user for `git push`.                                                     |
| **`scarlet` user**       | A dedicated Linux system user with minimal permissions, under which the Scarlet systemd service runs.                                                                                                                   |
| **Fine-grained PAT**     | A GitHub Personal Access Token scoped to specific repositories and permissions. Recommended for `GITHUB_TOKEN`.                                                                                                         |
