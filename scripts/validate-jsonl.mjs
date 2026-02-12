#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const [inputPath, schemaPathArg] = process.argv.slice(2);

if (!inputPath) {
  console.error(
    "Usage: node scripts/validate-jsonl.mjs <path-to.jsonl> [path-to-schema.json]"
  );
  process.exit(1);
}

const schemaPath =
  schemaPathArg ??
  path.join(process.cwd(), "schemas", "scarlet.capture-item.schema.json");

if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}
if (!fs.existsSync(schemaPath)) {
  console.error(`Schema not found: ${schemaPath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const validate = ajv.compile(schema);

let lineNo = 0;
let okCount = 0;
let errCount = 0;

const rl = readline.createInterface({
  input: fs.createReadStream(inputPath, "utf8"),
  crlfDelay: Infinity
});

for await (const line of rl) {
  lineNo++;
  const trimmed = line.trim();
  if (!trimmed) continue;

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (e) {
    errCount++;
    console.error(`Line ${lineNo}: invalid JSON: ${e.message}`);
    continue;
  }

  const ok = validate(obj);
  if (!ok) {
    errCount++;
    console.error(`Line ${lineNo}: schema errors:`);
    for (const err of validate.errors ?? []) {
      console.error(`  - ${err.instancePath || "(root)"} ${err.message}`);
    }
  } else {
    okCount++;
  }
}

if (errCount > 0) {
  console.error(`FAILED: ${errCount} invalid, ${okCount} valid`);
  process.exit(1);
} else {
  console.log(`OK: ${okCount} valid`);
}
