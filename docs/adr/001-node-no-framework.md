# ADR 001: Node.js Without a Framework

## Status
Accepted

## Context
Scarlet needs to run as a long-lived process that polls git repos and dispatches coding agents. We considered Deno, Bun, Python, and Go as alternatives.

## Decision
Use Node.js 20+ with no web framework. Built-in APIs (`fetch`, `node:test`, `parseArgs`, `child_process`) cover all needs. ESM modules (`.mjs`) for consistency with the existing codebase.

## Consequences
- Zero runtime dependencies beyond Node.js itself
- AJV (already a devDependency) reused for config validation
- Contributors need only Node.js installed
- No framework lock-in; each module is a plain function export
