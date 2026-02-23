import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPRD } from '../../src/prd/loader.js';

describe('loadPRD', () => {
  it('loads v1 PRD through the v1 parser', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentloop-prd-v1-'));
    try {
      const file = join(dir, 'prd-v1.md');
      writeFileSync(
        file,
        `# Project: Legacy App

## Meta
- **Tech Stack:** TypeScript

## Context
Legacy project context.

## Tasks

### Task 1: Example
- **ID:** T-001
- **Depends:** none
- **Files:** src/example.ts
- **Description:** Do example work
- **Acceptance Criteria:**
  - AC-1: Example works
- **Tests:**
  - \`tests/example.test.ts\` — passes
`,
        'utf-8',
      );

      const loaded = loadPRD(file);
      expect(loaded.format).toBe('v1');
      expect(loaded.name).toBe('Legacy App');
      expect(loaded.prd).toBeDefined();
      if (loaded.format === 'v1') {
        expect(loaded.prd.projectName).toBe('Legacy App');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads v2 PRD through the v2 parser', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentloop-prd-v2-'));
    try {
      const file = join(dir, 'prd-v2.md');
      writeFileSync(
        file,
        `# PRD: New Login

## Summary
Implement new login UX.

## Acceptance Criteria
- AC-1: Users can submit login credentials
`,
        'utf-8',
      );

      const loaded = loadPRD(file);
      expect(loaded.format).toBe('v2');
      expect(loaded.name).toBe('New Login');
      expect(loaded.prd).toBeDefined();
      if (loaded.format === 'v2') {
        expect(loaded.prd.name).toBe('New Login');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws user-friendly error when PRD file does not exist', () => {
    expect(() => loadPRD('/nonexistent/path/prd.md')).toThrow('PRD file not found');
  });

  it('throws user-friendly error with path in message', () => {
    const badPath = '/tmp/does-not-exist-12345.md';
    expect(() => loadPRD(badPath)).toThrow(badPath);
  });
});
