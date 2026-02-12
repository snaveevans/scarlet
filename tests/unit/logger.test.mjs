import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../../src/logger/index.mjs';

let tmpDir;

describe('logger', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scarlet-logger-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes JSON lines to file', () => {
    const logFile = path.join(tmpDir, 'test.log');
    const logger = createLogger({ level: 'info', file: logFile });
    logger.info('hello', { key: 'value' });
    logger.close();
    const content = fs.readFileSync(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    assert.equal(entry.msg, 'hello');
    assert.equal(entry.level, 'info');
    assert.equal(entry.key, 'value');
    assert.ok(entry.ts);
  });

  it('respects log level', () => {
    const logFile = path.join(tmpDir, 'test.log');
    const logger = createLogger({ level: 'warn', file: logFile });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.close();
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).msg, 'w');
    assert.equal(JSON.parse(lines[1]).msg, 'e');
  });

  it('creates nested log directory', () => {
    const logFile = path.join(tmpDir, 'sub', 'dir', 'test.log');
    const logger = createLogger({ level: 'info', file: logFile });
    logger.info('nested');
    logger.close();
    assert.ok(fs.existsSync(logFile));
  });

  it('defaults to info level', () => {
    const logFile = path.join(tmpDir, 'test.log');
    const logger = createLogger({ file: logFile });
    logger.debug('hidden');
    logger.info('shown');
    logger.close();
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).msg, 'shown');
  });
});
