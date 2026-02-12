#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/repo"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Initializing test repo at $REPO_DIR"
  git init -b main "$REPO_DIR"
  cd "$REPO_DIR"
  git config user.email "test@test.com"
  git config user.name "Test"
  echo "# Test Repo" > README.md
  git add -A
  git commit -m "init"
else
  cd "$REPO_DIR"
fi

# Add a sample PRD
mkdir -p docs/prd
cat > docs/prd/hello-world.md << 'EOF'
# PRD: Hello World

## Goal
Create a simple hello world script.

## Requirements
- Create a `hello.js` file that prints "Hello, World!" to stdout
- Add a test that verifies the output
EOF

git add -A
git commit -m "Add hello-world PRD" || echo "No changes to commit"

echo "Seed complete. PRDs:"
find docs/prd -name '*.md' -not -name '*TEMPLATE*' 2>/dev/null || echo "none"
