import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('systemd template', () => {
  const templatePath = path.resolve('systemd/scarlet@.service');

  it('runs as scarlet user with env file configured', () => {
    const template = fs.readFileSync(templatePath, 'utf8');
    assert.ok(template.includes('User=scarlet'));
    assert.ok(template.includes('Group=scarlet'));
    assert.ok(template.includes('EnvironmentFile=-/etc/scarlet/%i.env'));
  });

  it('supports install-time directory substitution', () => {
    const template = fs.readFileSync(templatePath, 'utf8');
    assert.ok(template.includes('__SCARLET_DIR__'));

    const rendered = template.replace(/__SCARLET_DIR__/g, '/opt/scarlet');
    assert.ok(!rendered.includes('__SCARLET_DIR__'));
    assert.ok(rendered.includes('ExecStart=/usr/bin/node /opt/scarlet/src/index.mjs --config /etc/scarlet/%i.json'));
  });
});
