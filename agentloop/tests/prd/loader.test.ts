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
      expect(loaded.v1?.projectName).toBe('Legacy App');
      expect(loaded.v2).toBeUndefined();
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
      expect(loaded.v2?.name).toBe('New Login');
      expect(loaded.v1).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
