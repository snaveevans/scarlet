#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/setup-prd-log-watch-test.sh <prd-file> <project-root>

Purpose:
  Prepare a manual PRD run test with live progress-log watching.
  This script only sets up and prints commands; it does not start a run.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

prd_input="$1"
project_input="$2"

if [[ ! -f "$prd_input" ]]; then
  echo "Error: PRD file not found: $prd_input" >&2
  exit 1
fi

if [[ ! -d "$project_input" ]]; then
  echo "Error: Project root not found: $project_input" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cli_entry="$repo_root/agentloop/dist/index.js"

if [[ ! -f "$cli_entry" ]]; then
  echo "Error: AgentLoop build not found at $cli_entry" >&2
  echo "Run: npm run build" >&2
  exit 1
fi

prd_file="$(cd "$(dirname "$prd_input")" && pwd)/$(basename "$prd_input")"
project_root="$(cd "$project_input" && pwd)"
log_dir="$project_root/.agentloop"
log_file="$log_dir/progress.log"

mkdir -p "$log_dir"
touch "$log_file"

cat <<EOF
Setup complete. Run these in separate terminals:

1) Start the PRD run (choose one key env var):
   cd "$project_root"
   ANTHROPIC_API_KEY=<key> node "$cli_entry" run "$prd_file" --verbose
   # or
   OPENAI_API_KEY=<key> node "$cli_entry" run "$prd_file" --verbose

2) Watch live progress logs:
   tail -f "$log_file"

3) Poll structured status:
   node "$cli_entry" status --project-root "$project_root"
EOF
