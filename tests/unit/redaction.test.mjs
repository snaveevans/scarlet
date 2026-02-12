import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { containsLikelySecret, redactSensitive, truncateForReport } from '../../src/redaction/index.mjs';

describe('redaction', () => {
  it('redacts github tokens and auth headers', () => {
    const input = [
      'token=ghp_1234567890abcdefghijklmnopqrstuvwxyz',
      'Authorization: Bearer super-secret-token',
    ].join('\n');

    const output = redactSensitive(input);
    assert.ok(!output.includes('super-secret-token'));
    assert.ok(!output.includes('ghp_1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(output.includes('[REDACTED_GITHUB_TOKEN]'));
    assert.ok(output.includes('Authorization: Bearer [REDACTED]'));
  });

  it('detects likely secrets in text', () => {
    assert.equal(containsLikelySecret('safe text only'), false);
    assert.equal(
      containsLikelySecret('Authorization: Bearer super-secret-token-value'),
      true
    );
  });

  it('truncates long report payloads', () => {
    const text = 'a'.repeat(100);
    const truncated = truncateForReport(text, 20);
    assert.ok(truncated.startsWith('aaaaaaaaaaaaaaaaaaaa'));
    assert.ok(truncated.includes('[truncated 80 chars]'));
  });
});
