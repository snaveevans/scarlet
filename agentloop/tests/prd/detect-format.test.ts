import { describe, it, expect } from 'vitest';
import { detectPRDFormat } from '../../src/prd/detect-format.js';

describe('detectPRDFormat', () => {
  it('detects v1 by tasks section', () => {
    const content = `# Something

## Tasks
- task`;

    expect(detectPRDFormat(content)).toBe('v1');
  });

  it('detects v1 by project header', () => {
    const content = `# Project: My App

## Context
...`;

    expect(detectPRDFormat(content)).toBe('v1');
  });

  it('detects v2 by acceptance criteria section', () => {
    const content = `# Feature Doc

## Acceptance Criteria
- AC-1: ...`;

    expect(detectPRDFormat(content)).toBe('v2');
  });

  it('detects v2 by PRD header', () => {
    const content = `# PRD: Login

## Summary
...`;

    expect(detectPRDFormat(content)).toBe('v2');
  });

  it('prefers v1 when markers are ambiguous', () => {
    const content = `# PRD: Mixed

## Tasks
...`;

    expect(detectPRDFormat(content)).toBe('v1');
  });

  it('throws on unknown format', () => {
    const content = `# Random

## Notes
just notes`;

    expect(() => detectPRDFormat(content)).toThrow('Could not detect PRD format');
  });
});
