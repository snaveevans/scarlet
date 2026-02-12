import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '../../schemas/scarlet.instance-config.schema.json');

function interpolateEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolateEnv(v);
    }
    return result;
  }
  return value;
}

const DEFAULTS = {
  targetRepo: { mainBranch: 'main', prdGlob: 'docs/prd/**/*.md' },
  polling: { intervalSeconds: 60 },
  agent: { timeout: 300 },
  git: { branchPrefix: 'scarlet/', commitAuthor: 'Scarlet Agent <scarlet@example.com>', createPr: true },
  state: { path: '.scarlet/state.json' },
  logging: { level: 'info' },
};

function applyDefaults(config) {
  const c = { ...config };
  c.targetRepo = { ...DEFAULTS.targetRepo, ...c.targetRepo };
  c.polling = { ...DEFAULTS.polling, ...c.polling };
  c.agent = { ...DEFAULTS.agent, ...c.agent };
  c.git = { ...DEFAULTS.git, ...c.git };
  c.state = { ...DEFAULTS.state, ...c.state };
  c.logging = { ...DEFAULTS.logging, ...c.logging };
  return c;
}

export function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const interpolated = interpolateEnv(parsed);
  const withDefaults = applyDefaults(interpolated);

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(withDefaults)) {
    const messages = validate.errors.map(e => `${e.instancePath} ${e.message}`).join('; ');
    throw new Error(`Invalid config: ${messages}`);
  }

  return withDefaults;
}
