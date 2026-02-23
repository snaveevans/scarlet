import type { CodebaseUnderstanding } from '../comprehension/types.js';
import type { Skill } from './types.js';

export function generateContext(
  understanding: CodebaseUnderstanding,
  skills: Skill[],
): string {
  const lines: string[] = [];
  lines.push('# Scarlet Context');
  lines.push('');
  lines.push('## Project');
  lines.push(
    `- Language: ${understanding.project.language}`,
    `- Framework: ${understanding.project.framework}`,
    `- Package manager: ${understanding.project.packageManager}`,
    `- Test framework: ${understanding.project.testFramework}`,
    `- Build tool: ${understanding.project.buildTool}`,
  );
  lines.push('');

  lines.push('## Commands');
  const commandEntries = Object.entries(understanding.project.commands)
    .filter(([, command]) => typeof command === 'string' && command.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (commandEntries.length === 0) {
    lines.push('- None discovered');
  } else {
    for (const [name, command] of commandEntries) {
      lines.push(`- ${name}: \`${command}\``);
    }
  }
  lines.push('');

  lines.push('## Conventions');
  lines.push(`- File organization: ${understanding.conventions.fileOrganization}`);
  lines.push(`- Test organization: ${understanding.conventions.testOrganization}`);
  lines.push(`- Import style: ${understanding.conventions.importStyle}`);
  lines.push('');

  lines.push('## Relevant Code');
  if (understanding.relevantCode.length === 0) {
    lines.push('- None recorded');
  } else {
    for (const item of understanding.relevantCode) {
      const exportsSummary =
        item.keyExports.length > 0 ? item.keyExports.join(', ') : '(none)';
      lines.push(`- \`${item.path}\` — ${item.purpose} (exports: ${exportsSummary})`);
    }
  }
  lines.push('');

  lines.push('## Learned Skills');
  if (skills.length === 0) {
    lines.push('- None yet');
  } else {
    for (const skill of skills) {
      lines.push(`- ${skill.name}: ${skill.description}`);
      lines.push(`  - Trigger: ${skill.trigger.join(', ') || '(none)'}`);
      lines.push(`  - Tags: ${skill.tags.join(', ') || '(none)'}`);
      lines.push(`  - Confidence: ${skill.confidence.toFixed(2)}`);
      lines.push(`  - Pattern: ${skill.content}`);
    }
  }
  lines.push('');

  lines.push('## Team Notes');
  lines.push(
    '<!-- SCARLET_USER_NOTES_START -->',
    '(Add project-specific notes here. This section is intended for human edits.)',
    '<!-- SCARLET_USER_NOTES_END -->',
  );

  return lines.join('\n');
}
