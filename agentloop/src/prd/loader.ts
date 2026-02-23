import { readFileSync } from 'node:fs';
import { detectPRDFormat } from './detect-format.js';
import type { PRDFormat } from './detect-format.js';
import { parsePRD } from './parser.js';
import { parsePRDv2 } from './parser-v2.js';
import type { PRD, PRDMeta } from './schemas.js';
import type { PRDv2 } from './schemas-v2.js';
import { validatePrdCommand } from '../utils/shell.js';

export type LoadedPRD =
  | { format: 'v1'; prd: PRD; name: string }
  | { format: 'v2'; prd: PRDv2; name: string };

/**
 * Validate that PRD meta commands are safe for shell execution.
 */
function validateMetaCommands(meta: PRDMeta): void {
  validatePrdCommand(meta.typecheckCommand, 'typecheckCommand');
  validatePrdCommand(meta.lintCommand, 'lintCommand');
  validatePrdCommand(meta.buildCommand, 'buildCommand');
}

/**
 * Load and parse a PRD file using automatic format detection.
 */
export function loadPRD(filePath: string): LoadedPRD {
  const content = readFileSync(filePath, 'utf-8');
  return loadPRDContent(content);
}

/**
 * Parse PRD content using automatic format detection.
 */
export function loadPRDContent(content: string): LoadedPRD {
  const format = detectPRDFormat(content);

  if (format === 'v1') {
    const v1 = parsePRD(content);
    validateMetaCommands(v1.meta);
    return {
      format,
      prd: v1,
      name: v1.projectName,
    };
  }

  const v2 = parsePRDv2(content);
  return {
    format,
    prd: v2,
    name: v2.name,
  };
}
