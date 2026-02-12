#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function slugify(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const title = process.argv.slice(2).join(" ").trim();
if (!title) {
  console.error('Usage: node scripts/render-prd.mjs "My PRD Title"');
  process.exit(1);
}

const repoRoot = process.cwd();
const templatePath = path.join(repoRoot, "docs", "prd", "PRD_TEMPLATE.md");
const outDir = path.join(repoRoot, "docs", "prd");

if (!fs.existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

const template = fs.readFileSync(templatePath, "utf8");
const now = new Date();
const yyyy = String(now.getFullYear());
const mm = String(now.getMonth() + 1).padStart(2, "0");
const dd = String(now.getDate()).padStart(2, "0");

const slug = slugify(title);
const filename = `${yyyy}-${mm}-${dd}-${slug}.md`;
const outPath = path.join(outDir, filename);

const rendered = template.replace("# PRD: <TITLE>", `# PRD: ${title}`);

fs.writeFileSync(outPath, rendered, "utf8");
console.log(outPath);
