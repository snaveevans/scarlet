export type PRDFormat = 'v1' | 'v2';

/**
 * Detect whether a PRD uses legacy task-based format (v1) or AC-only format (v2).
 */
export function detectPRDFormat(content: string): PRDFormat {
  const hasProjectHeader = /^#\s+Project:\s+/mi.test(content);
  const hasTasksSection = /^##\s+Tasks\s*$/mi.test(content);

  // Prefer v1 when both styles appear so legacy PRDs remain stable.
  if (hasProjectHeader || hasTasksSection) {
    return 'v1';
  }

  const hasPRDHeader = /^#\s+PRD:\s+/mi.test(content);
  const hasACSection = /^##\s+Acceptance Criteria\s*$/mi.test(content);

  if (hasPRDHeader || hasACSection) {
    return 'v2';
  }

  throw new Error(
    'Could not detect PRD format. Expected v1 (# Project + ## Tasks) or v2 (# PRD + ## Acceptance Criteria).',
  );
}
