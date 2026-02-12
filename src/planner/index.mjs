export function planFromPrd(prdContent, prdPath) {
  let title = '';
  let requirements = '';

  // Try JSON parse first
  try {
    const parsed = JSON.parse(prdContent);
    title = parsed.title || parsed.name || '';
    requirements = parsed.description || parsed.requirements || prdContent;
  } catch {
    // Markdown: extract title from first heading
    const titleMatch = prdContent.match(/^#\s+(?:PRD:\s*)?(.+)$/m);
    title = titleMatch ? titleMatch[1].trim() : '';
    requirements = prdContent;
  }

  if (!title) {
    // Fallback: derive from filename
    const base = prdPath.replace(/^.*\//, '').replace(/\.\w+$/, '');
    title = base.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ');
  }

  const branchName = slugify(title);
  const instructions = buildInstructions(title, requirements, prdPath);

  return { title, branchName, instructions };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function buildInstructions(title, requirements, prdPath) {
  return [
    `## Task: ${title}`,
    '',
    `Implement the requirements described in the PRD at \`${prdPath}\`.`,
    '',
    '## Requirements',
    '',
    requirements,
    '',
    '## Guidelines',
    '- Follow existing code conventions in this repository',
    '- Write tests for new functionality',
    '- Keep changes focused on the PRD requirements',
  ].join('\n');
}
