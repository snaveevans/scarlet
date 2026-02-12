import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const scriptPath = path.resolve("scripts/render-prd.mjs");

function run(args, cwd) {
  return execFileSync("node", [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
}

function runExpectFail(args, cwd) {
  try {
    execFileSync("node", [scriptPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.fail("Expected script to exit with non-zero code");
  } catch (err) {
    return err;
  }
}

describe("render-prd", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-prd-test-"));
    const prdDir = path.join(tmpDir, "docs", "prd");
    fs.mkdirSync(prdDir, { recursive: true });
    fs.copyFileSync(
      path.resolve("docs/prd/PRD_TEMPLATE.md"),
      path.join(prdDir, "PRD_TEMPLATE.md")
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should exit with error when no title is provided", () => {
    const err = runExpectFail([], tmpDir);
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /Usage:/);
  });

  it("should create a dated markdown file with the slugified title", () => {
    const stdout = run(["My Feature Name"], tmpDir);
    const outPath = stdout.trim();

    assert.ok(fs.existsSync(outPath), `Output file should exist: ${outPath}`);

    const filename = path.basename(outPath);
    assert.match(filename, /^\d{4}-\d{2}-\d{2}-my-feature-name\.md$/);
  });

  it("should replace <TITLE> placeholder with the provided title", () => {
    const stdout = run(["My Feature Name"], tmpDir);
    const content = fs.readFileSync(stdout.trim(), "utf8");

    assert.ok(content.includes("# PRD: My Feature Name"));
    assert.ok(!content.includes("<TITLE>"));
  });

  it("should preserve all template sections in the output", () => {
    const stdout = run(["Test"], tmpDir);
    const content = fs.readFileSync(stdout.trim(), "utf8");

    const expectedSections = [
      "## Metadata",
      "## Summary",
      "## Problem",
      "## Goals",
      "## Non-Goals",
      "## Users & Use Cases",
      "## Requirements",
      "## Scope",
      "## UX / Product Notes",
      "## Data Model",
      "## API / Integrations",
      "## Edge Cases",
      "## Metrics & Success Criteria",
      "## Rollout Plan",
      "## Risks & Mitigations",
      "## Open Questions",
      "## Appendix",
    ];

    for (const section of expectedSections) {
      assert.ok(content.includes(section), `Missing section: ${section}`);
    }
  });

  it("should slugify titles with special characters", () => {
    const stdout = run(["Hello, World! (v2)"], tmpDir);
    const filename = path.basename(stdout.trim());

    assert.match(filename, /hello-world-v2\.md$/);
  });

  it("should handle multi-word titles passed as separate args", () => {
    const stdout = run(["Multi", "Word", "Title"], tmpDir);
    const filename = path.basename(stdout.trim());

    assert.match(filename, /multi-word-title\.md$/);
  });

  it("should fail when template is missing", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-template-"));
    try {
      const err = runExpectFail(["Test"], emptyDir);
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /Template not found/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
