import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planFromPrd } from '../../src/planner/index.mjs';

describe('planner', () => {
  it('parses markdown PRD title', () => {
    const result = planFromPrd('# PRD: My Cool Feature\n\nDo things.', 'docs/prd/my-cool-feature.md');
    assert.equal(result.title, 'My Cool Feature');
    assert.equal(result.branchName, 'my-cool-feature');
    assert.ok(result.instructions.includes('My Cool Feature'));
    assert.ok(result.instructions.includes('docs/prd/my-cool-feature.md'));
  });

  it('parses markdown heading without PRD prefix', () => {
    const result = planFromPrd('# Add Login\n\nRequirements here.', 'docs/prd/add-login.md');
    assert.equal(result.title, 'Add Login');
    assert.equal(result.branchName, 'add-login');
  });

  it('parses JSON PRD', () => {
    const json = JSON.stringify({ title: 'API Refactor', description: 'Refactor the API layer.' });
    const result = planFromPrd(json, 'docs/prd/api-refactor.json');
    assert.equal(result.title, 'API Refactor');
    assert.equal(result.branchName, 'api-refactor');
    assert.ok(result.instructions.includes('Refactor the API layer.'));
  });

  it('falls back to filename when no title found', () => {
    const result = planFromPrd('Just some text without heading.', 'docs/prd/2024-01-15-widget-update.md');
    assert.equal(result.title, 'widget update');
    assert.equal(result.branchName, 'widget-update');
  });

  it('truncates long branch names', () => {
    const title = '# ' + 'a'.repeat(100);
    const result = planFromPrd(title, 'docs/prd/long.md');
    assert.ok(result.branchName.length <= 60);
  });

  it('handles special characters in title', () => {
    const result = planFromPrd('# PRD: Add OAuth 2.0 (RFC 6749) Support!', 'docs/prd/oauth.md');
    assert.equal(result.branchName, 'add-oauth-2-0-rfc-6749-support');
  });
});
