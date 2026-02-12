import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const scriptPath = path.resolve("scripts/validate-jsonl.mjs");
const schemaPath = path.resolve("schemas/scarlet.capture-item.schema.json");

function writeJsonl(dir, filename, lines) {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writeRawJsonl(dir, filename, content) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function run(args) {
  return execFileSync("node", [scriptPath, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runExpectFail(args) {
  try {
    execFileSync("node", [scriptPath, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.fail("Expected script to exit with non-zero code");
  } catch (err) {
    return err;
  }
}

function validItem(overrides = {}) {
  return {
    id: "abcdefgh-1234-5678-abcd-1234567890ab",
    createdAt: "2025-01-15T10:30:00Z",
    rawText: "Remember to call dentist",
    classification: {
      bucket: "admin",
      confidence: 0.9,
    },
    ...overrides,
  };
}

describe("validate-jsonl", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-jsonl-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should exit with error when no arguments are provided", () => {
    const err = runExpectFail([]);
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /Usage:/);
  });

  it("should exit with error when input file does not exist", () => {
    const err = runExpectFail(["/nonexistent/file.jsonl", schemaPath]);
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /Input not found/);
  });

  it("should validate a single valid item", () => {
    const filePath = writeJsonl(tmpDir, "valid.jsonl", [validItem()]);
    const stdout = run([filePath, schemaPath]);

    assert.match(stdout, /OK: 1 valid/);
  });

  it("should validate multiple valid items", () => {
    const items = [
      validItem(),
      validItem({
        id: "12345678-aaaa-bbbb-cccc-dddddddddddd",
        rawText: "Call mom",
        classification: { bucket: "people", confidence: 0.85 },
      }),
      validItem({
        id: "zzzzzzzz-1111-2222-3333-444444444444",
        rawText: "New app idea",
        classification: { bucket: "idea", confidence: 0.7 },
      }),
    ];
    const filePath = writeJsonl(tmpDir, "multi.jsonl", items);
    const stdout = run([filePath, schemaPath]);

    assert.match(stdout, /OK: 3 valid/);
  });

  it("should reject an item missing required field 'id'", () => {
    const item = validItem();
    delete item.id;
    const filePath = writeJsonl(tmpDir, "no-id.jsonl", [item]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /FAILED: 1 invalid/);
  });

  it("should reject an item missing required field 'classification'", () => {
    const item = validItem();
    delete item.classification;
    const filePath = writeJsonl(tmpDir, "no-class.jsonl", [item]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /FAILED: 1 invalid/);
  });

  it("should reject an item missing required field 'rawText'", () => {
    const item = validItem();
    delete item.rawText;
    const filePath = writeJsonl(tmpDir, "no-rawtext.jsonl", [item]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should reject an item missing required field 'createdAt'", () => {
    const item = validItem();
    delete item.createdAt;
    const filePath = writeJsonl(tmpDir, "no-created.jsonl", [item]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should reject an id that is too short", () => {
    const filePath = writeJsonl(tmpDir, "short-id.jsonl", [
      validItem({ id: "abc" }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /FAILED/);
  });

  it("should reject an invalid bucket value", () => {
    const filePath = writeJsonl(tmpDir, "bad-bucket.jsonl", [
      validItem({
        classification: { bucket: "unknown", confidence: 0.5 },
      }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should reject confidence outside 0-1 range", () => {
    const filePath = writeJsonl(tmpDir, "bad-confidence.jsonl", [
      validItem({
        classification: { bucket: "idea", confidence: 1.5 },
      }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should reject invalid createdAt format", () => {
    const filePath = writeJsonl(tmpDir, "bad-date.jsonl", [
      validItem({ createdAt: "not-a-date" }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should reject additional properties not in the schema", () => {
    const filePath = writeJsonl(tmpDir, "extra-props.jsonl", [
      validItem({ extraField: "not allowed" }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should handle invalid JSON lines", () => {
    const filePath = writeRawJsonl(
      tmpDir,
      "bad-json.jsonl",
      "{not valid json}\n"
    );
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /invalid JSON/);
  });

  it("should skip blank lines", () => {
    const item = validItem();
    const content = "\n" + JSON.stringify(item) + "\n\n";
    const filePath = writeRawJsonl(tmpDir, "blanks.jsonl", content);
    const stdout = run([filePath, schemaPath]);

    assert.match(stdout, /OK: 1 valid/);
  });

  it("should report mixed valid and invalid items", () => {
    const good = validItem();
    const bad = validItem();
    delete bad.id;
    const content =
      JSON.stringify(good) + "\n" + JSON.stringify(bad) + "\n";
    const filePath = writeRawJsonl(tmpDir, "mixed.jsonl", content);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /FAILED: 1 invalid, 1 valid/);
  });

  it("should accept all optional fields when present", () => {
    const full = validItem({
      source: { kind: "cli", device: "iphone", app: "scarlet" },
      classification: {
        bucket: "project",
        confidence: 0.95,
        nowNextNever: "now",
        title: "My Project",
        summary: "A cool project idea",
        tags: ["work", "urgent"],
      },
      links: ["https://example.com"],
      refs: { projectId: "proj-123", personId: "person-456" },
    });
    const filePath = writeJsonl(tmpDir, "full.jsonl", [full]);
    const stdout = run([filePath, schemaPath]);

    assert.match(stdout, /OK: 1 valid/);
  });

  it("should reject invalid source kind", () => {
    const filePath = writeJsonl(tmpDir, "bad-source.jsonl", [
      validItem({ source: { kind: "telegram" } }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });

  it("should reject invalid nowNextNever value", () => {
    const filePath = writeJsonl(tmpDir, "bad-nnn.jsonl", [
      validItem({
        classification: { bucket: "idea", confidence: 0.5, nowNextNever: "later" },
      }),
    ]);
    const err = runExpectFail([filePath, schemaPath]);

    assert.equal(err.status, 1);
  });
});
