import { describe, it, expect } from 'vitest';
import { parsePRD } from '../../src/prd/parser.js';

const SAMPLE_PRD = `# Project: My App

## Meta
- **Tech Stack:** React, TypeScript, pnpm
- **Test Framework:** vitest
- **Lint Command:** pnpm lint
- **Build Command:** pnpm build
- **Typecheck Command:** pnpm typecheck
- **Project Root:** ./

## Context
This is a React application using TypeScript.
Follow functional component patterns.

## Tasks

### Task 1: Setup project scaffold
- **ID:** T-001
- **Depends:** none
- **Files:** src/index.ts, package.json
- **Description:** Initialize the project structure with all required files
- **Acceptance Criteria:**
  - Project builds successfully
  - TypeScript is configured
- **Tests:**
  - \`src/__tests__/index.test.ts\` — basic imports work

### Task 2: Add auth module
- **ID:** T-002
- **Depends:** T-001
- **Files:** src/auth.ts, src/middleware.ts
- **Description:** Implement authentication
- **Acceptance Criteria:**
  - Users can log in
  - Sessions are persisted
- **Tests:**
  - \`src/__tests__/auth.test.ts\` — login works
`;

describe('parsePRD', () => {
  it('parses project name', () => {
    const prd = parsePRD(SAMPLE_PRD);
    expect(prd.projectName).toBe('My App');
  });

  it('parses meta fields', () => {
    const prd = parsePRD(SAMPLE_PRD);
    expect(prd.meta.techStack).toBe('React, TypeScript, pnpm');
    expect(prd.meta.testFramework).toBe('vitest');
    expect(prd.meta.lintCommand).toBe('pnpm lint');
    expect(prd.meta.buildCommand).toBe('pnpm build');
    expect(prd.meta.typecheckCommand).toBe('pnpm typecheck');
    expect(prd.meta.projectRoot).toBe('./');
  });

  it('parses context block', () => {
    const prd = parsePRD(SAMPLE_PRD);
    expect(prd.context).toContain('React application');
    expect(prd.context).toContain('TypeScript');
  });

  it('parses tasks count', () => {
    const prd = parsePRD(SAMPLE_PRD);
    expect(prd.tasks).toHaveLength(2);
  });

  it('parses first task fields', () => {
    const prd = parsePRD(SAMPLE_PRD);
    const task = prd.tasks[0]!;
    expect(task.id).toBe('T-001');
    expect(task.title).toBe('Setup project scaffold');
    expect(task.depends).toEqual([]);
    expect(task.files).toContain('src/index.ts');
    expect(task.files).toContain('package.json');
    expect(task.description).toBe('Initialize the project structure with all required files');
    expect(task.acceptanceCriteria).toContain('Project builds successfully');
    expect(task.acceptanceCriteria).toContain('TypeScript is configured');
  });

  it('parses second task with dependency', () => {
    const prd = parsePRD(SAMPLE_PRD);
    const task = prd.tasks[1]!;
    expect(task.id).toBe('T-002');
    expect(task.depends).toEqual(['T-001']);
    expect(task.files).toContain('src/auth.ts');
    expect(task.files).toContain('src/middleware.ts');
  });

  it('parses test file paths from backtick notation', () => {
    const prd = parsePRD(SAMPLE_PRD);
    expect(prd.tasks[0]!.tests).toContain('src/__tests__/index.test.ts');
    expect(prd.tasks[1]!.tests).toContain('src/__tests__/auth.test.ts');
  });

  it('sets default task status to pending', () => {
    const prd = parsePRD(SAMPLE_PRD);
    expect(prd.tasks[0]!.status).toBe('pending');
    expect(prd.tasks[1]!.status).toBe('pending');
  });

  it('throws on missing project name', () => {
    const bad = SAMPLE_PRD.replace('# Project: My App', '# My App');
    expect(() => parsePRD(bad)).toThrow('PRD must have a');
  });

  it('handles PRD with no tasks section', () => {
    const noPrd = `# Project: Empty\n\n## Meta\n- **Tech Stack:** Node\n\n## Context\nContext here.\n`;
    const prd = parsePRD(noPrd);
    expect(prd.tasks).toHaveLength(0);
  });

  it('uses defaults for missing meta fields', () => {
    const minimal = `# Project: Min\n\n## Context\nHello\n\n## Tasks\n`;
    const prd = parsePRD(minimal);
    expect(prd.meta.testFramework).toBe('vitest');
    expect(prd.meta.lintCommand).toBe('pnpm lint');
    expect(prd.meta.projectRoot).toBe('./');
  });
});
