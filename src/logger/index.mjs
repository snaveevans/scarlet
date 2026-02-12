import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(opts = {}) {
  const minLevel = LEVELS[opts.level ?? 'info'] ?? LEVELS.info;
  let logFile = null;

  if (opts.file) {
    const dir = path.dirname(opts.file);
    fs.mkdirSync(dir, { recursive: true });
    logFile = opts.file;
  }

  function log(level, message, data) {
    if (LEVELS[level] < minLevel) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...data,
    };
    const line = JSON.stringify(entry);
    process.stdout.write(line + '\n');
    if (logFile) fs.appendFileSync(logFile, line + '\n');
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
    close() { logFile = null; },
  };
}
