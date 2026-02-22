import { readFileSync } from 'node:fs';
import { PRDv2 } from './schemas-v2.js';
import type { PRDv2 as PRDv2Type } from './schemas-v2.js';

/**
 * Parse a v2 PRD markdown file into a structured PRD object.
 */
export function parsePRDv2File(filePath: string): PRDv2Type {
  const content = readFileSync(filePath, 'utf-8');
  return parsePRDv2(content);
}

export function parsePRDv2(content: string): PRDv2Type {
  const name = extractName(content);
  const summary = extractRequiredSection(content, 'Summary');
  const acceptanceCriteria = extractAcceptanceCriteria(content);
  const constraints = extractConstraints(content);
  const adrs = extractADRs(content);
  const notes = extractSection(content, 'Notes') ?? undefined;

  return PRDv2.parse({
    name,
    summary,
    acceptanceCriteria,
    constraints,
    adrs,
    notes,
  });
}

function extractName(content: string): string {
  const match = /^#\s+PRD:\s+(.+)$/mi.exec(content);
  if (!match?.[1]) {
    throw new Error('PRD v2 must have a "# PRD: <feature-name>" heading');
  }
  return match[1].trim();
}

function extractRequiredSection(content: string, sectionName: string): string {
  const section = extractSection(content, sectionName);
  if (!section) {
    throw new Error(`PRD v2 must have a "## ${sectionName}" section`);
  }
  return section;
}

function extractAcceptanceCriteria(
  content: string,
): Array<{ id: string; description: string }> {
  const section = extractRequiredSection(content, 'Acceptance Criteria');
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const criteria = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => {
      const match = /^[-*]\s*(?:\[[ xX]\]\s*)?(AC-\d+)\s*:\s*(.+)$/i.exec(line);
      if (!match?.[1] || !match[2]) {
        throw new Error(
          `Invalid acceptance criterion format: "${line}". Expected "- [ ] AC-1: Description"`,
        );
      }
      return {
        id: match[1].toUpperCase(),
        description: match[2].trim(),
      };
    });

  if (criteria.length === 0) {
    throw new Error('PRD v2 must include at least one acceptance criterion');
  }

  return criteria;
}

function extractConstraints(content: string): Array<{ description: string }> {
  const section = extractSection(content, 'Constraints');
  if (!section) {
    return [];
  }

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean)
    .map((description) => ({ description }));
}

function extractADRs(
  content: string,
): Array<{ id: string; title: string; decision: string; rationale: string }> {
  const section = extractSection(content, 'ADRs');
  if (!section) {
    return [];
  }

  const blocks = section.split(/^###\s+/m).filter(Boolean);

  return blocks.map((block) => {
    const lines = block
      .split('\n')
      .map((line) => line.trimEnd());
    const header = lines[0]?.trim();

    const headerMatch = /^(ADR-\d+)\s*:\s*(.+)$/i.exec(header ?? '');
    if (!headerMatch?.[1] || !headerMatch[2]) {
      throw new Error(
        `Invalid ADR heading: "${header ?? ''}". Expected "### ADR-001: Title"`,
      );
    }

    const bodyLines = lines.slice(1).filter((line) => line.trim().length > 0);
    const rationaleIndex = bodyLines.findIndex((line) =>
      /^Rationale:\s*/i.test(line.trim()),
    );

    if (rationaleIndex === -1) {
      throw new Error(`ADR "${headerMatch[1]}" must include a "Rationale:" line`);
    }

    const decision = bodyLines.slice(0, rationaleIndex).join('\n').trim();
    const rationaleLines = bodyLines.slice(rationaleIndex);
    rationaleLines[0] = (rationaleLines[0] ?? '').replace(
      /^Rationale:\s*/i,
      '',
    );
    const rationale = rationaleLines.join('\n').trim();

    if (!decision || !rationale) {
      throw new Error(
        `ADR "${headerMatch[1]}" must include both decision text and rationale`,
      );
    }

    return {
      id: headerMatch[1].toUpperCase(),
      title: headerMatch[2].trim(),
      decision,
      rationale,
    };
  });
}

/**
 * Extract a top-level ## Section from the markdown.
 * Returns the content between the heading and the next ## heading.
 */
function extractSection(content: string, sectionName: string): string | null {
  const lines = content.split('\n');
  const sectionRegex = new RegExp(`^##\\s+${sectionName}\\s*$`, 'i');
  const nextSectionRegex = /^##\s+/;

  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (!inSection) {
      if (sectionRegex.test(line)) {
        inSection = true;
      }
    } else {
      if (nextSectionRegex.test(line)) {
        break;
      }
      sectionLines.push(line);
    }
  }

  if (!inSection) return null;
  const result = sectionLines.join('\n').trim();
  return result || null;
}
