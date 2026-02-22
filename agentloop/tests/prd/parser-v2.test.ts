import { describe, it, expect } from 'vitest';
import { parsePRDv2 } from '../../src/prd/parser-v2.js';

const SAMPLE_V2 = `# PRD: Login Feature

## Summary
Implement a login flow using existing auth services.

## Acceptance Criteria
- [ ] AC-1: Users can submit email and password
- [ ] AC-2: Invalid credentials show an error message

## Constraints
- Keep existing route structure
- Reuse the existing auth API client

## ADRs
### ADR-001: Use existing auth endpoint
Do not add a new auth service; call the current API endpoint.
Rationale: Keeps backend surface area unchanged.

## Notes
Prefer existing UI component patterns in src/components/auth.
`;

describe('parsePRDv2', () => {
  it('parses a well-formed v2 PRD', () => {
    const prd = parsePRDv2(SAMPLE_V2);
    expect(prd.name).toBe('Login Feature');
    expect(prd.summary).toContain('login flow');
    expect(prd.acceptanceCriteria).toHaveLength(2);
  });

  it('extracts acceptance criteria IDs and descriptions', () => {
    const prd = parsePRDv2(SAMPLE_V2);
    expect(prd.acceptanceCriteria[0]).toEqual({
      id: 'AC-1',
      description: 'Users can submit email and password',
    });
    expect(prd.acceptanceCriteria[1]).toEqual({
      id: 'AC-2',
      description: 'Invalid credentials show an error message',
    });
  });

  it('extracts constraints', () => {
    const prd = parsePRDv2(SAMPLE_V2);
    expect(prd.constraints).toEqual([
      { description: 'Keep existing route structure' },
      { description: 'Reuse the existing auth API client' },
    ]);
  });

  it('extracts ADRs with decision and rationale', () => {
    const prd = parsePRDv2(SAMPLE_V2);
    expect(prd.adrs).toHaveLength(1);
    expect(prd.adrs[0]!.id).toBe('ADR-001');
    expect(prd.adrs[0]!.title).toBe('Use existing auth endpoint');
    expect(prd.adrs[0]!.decision).toContain('Do not add a new auth service');
    expect(prd.adrs[0]!.rationale).toContain('Keeps backend surface area unchanged');
  });

  it('extracts notes when present', () => {
    const prd = parsePRDv2(SAMPLE_V2);
    expect(prd.notes).toContain('Prefer existing UI component patterns');
  });

  it('handles missing optional sections', () => {
    const minimal = `# PRD: Minimal

## Summary
Summary text.

## Acceptance Criteria
- AC-1: One requirement
`;

    const prd = parsePRDv2(minimal);
    expect(prd.constraints).toEqual([]);
    expect(prd.adrs).toEqual([]);
    expect(prd.notes).toBeUndefined();
  });

  it('rejects PRD without summary', () => {
    const noSummary = `# PRD: Missing Summary

## Acceptance Criteria
- AC-1: One requirement
`;

    expect(() => parsePRDv2(noSummary)).toThrow('## Summary');
  });

  it('rejects PRD without acceptance criteria', () => {
    const noAC = `# PRD: Missing AC

## Summary
Summary text.
`;

    expect(() => parsePRDv2(noAC)).toThrow('## Acceptance Criteria');
  });

  it('rejects malformed acceptance criterion lines', () => {
    const bad = `# PRD: Bad AC

## Summary
Summary text.

## Acceptance Criteria
- [ ] Missing prefix
`;

    expect(() => parsePRDv2(bad)).toThrow('Invalid acceptance criterion format');
  });
});
