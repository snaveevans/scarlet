/**
 * Shared markdown / LLM-output parsing utilities.
 *
 * Centralises helpers that were previously duplicated across parser.ts,
 * parser-v2.ts, reflection.ts, and self-review.ts.
 */

/**
 * Extract a top-level `## Section` from markdown content.
 * Returns the content between the heading and the next `##` heading,
 * or `null` if the section is not found.
 */
export function extractSection(content: string, sectionName: string): string | null {
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

/**
 * Strip leading/trailing markdown code fences from a string.
 * Commonly needed when parsing JSON from LLM responses that wrap
 * output in ` ```json ... ``` ` blocks.
 */
export function stripCodeFence(value: string): string {
  if (!value.startsWith('```')) return value;
  return value
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
}
