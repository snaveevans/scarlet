/**
 * Tool runtime — registers all core tools into a {@link ToolRegistry}.
 */

export { DefaultToolRegistry } from './registry.js';
export { safePath } from './types.js';
export type { ToolHandler, ToolContext, ToolRegistry } from './types.js';

import { DefaultToolRegistry } from './registry.js';
import type { ToolRegistry } from './types.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { listDirectoryTool } from './list-directory.js';
import { searchFilesTool } from './search-files.js';
import { findFilesTool } from './find-files.js';
import { shellTool } from './shell-tool.js';

/** Create a registry with all core tools pre-registered. */
export function createCoreToolRegistry(): ToolRegistry {
  const registry = new DefaultToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(listDirectoryTool);
  registry.register(searchFilesTool);
  registry.register(findFilesTool);
  registry.register(shellTool);
  return registry;
}
