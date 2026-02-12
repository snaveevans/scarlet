const REDACTION_RULES = [
  {
    regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    regex: /github_pat_[A-Za-z0-9_]{20,}/g,
    replacement: '[REDACTED_GITHUB_PAT]',
  },
  {
    regex: /(Authorization:\s*Bearer\s+)[^\s]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    regex: /(api[_-]?key\s*[:=]\s*)(['"]?)[^'"\s]+\2/gi,
    replacement: '$1$2[REDACTED]$2',
  },
  {
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
];

const SECRET_DETECTION_PATTERNS = REDACTION_RULES.map(({ regex }) => regex);

export function redactSensitive(input) {
  let text = String(input ?? '');
  for (const rule of REDACTION_RULES) {
    text = text.replace(rule.regex, rule.replacement);
  }
  return text;
}

export function truncateForReport(input, maxChars = 8192) {
  const text = String(input ?? '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`;
}

export function containsLikelySecret(input) {
  const text = String(input ?? '');
  return SECRET_DETECTION_PATTERNS.some(pattern => {
    const clone = new RegExp(pattern.source, pattern.flags);
    return clone.test(text);
  });
}
