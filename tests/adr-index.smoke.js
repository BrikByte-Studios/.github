#!/usr/bin/env node
/**
 * Tiny smoke tests for ADR Index Generator.
 *
 * Validates that:
 *  - Index is generated
 *  - Contains at least the ID/title/status of the ADR
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TMP = path.join(__dirname, ".tmp-index");
const SCHEMA = path.join(__dirname, "..", "docs", "adr", "adr.schema.json");
const INDEXER = path.join(__dirname, "..", "scripts", "adr", "adr-index-generate.js");

function write(p, c) {
  const file = path.join(TMP, p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c, "utf-8");
  return file;
}

function run(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe" });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// Clean tmp
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
fs.mkdirSync(TMP);

// Create single valid ADR
const adrFile = write(
  "docs/adr/001-index-test.md",
  `---
id: "ADR-0100"
seq: 1
title: "Index Test ADR"
status: "Accepted"
date: "2025-01-01"
authors: [ "@dev" ]
area: [ "GOV" ]
---

# Test ADR
`
);

// Generate index
const indexPath = path.join(TMP, "docs/adr/000-index.md");

run(
  `node "${INDEXER}" --glob "${TMP}/docs/adr/*.md" --output "${indexPath}"`
);

// Validate existence
if (!fs.existsSync(indexPath)) {
  console.error("Test 1 — Index file not created: FAIL");
  process.exit(1);
}

console.log("Test 1 — Index file created: PASS");

// Validate contents
const content = fs.readFileSync(indexPath, "utf-8");

if (
  content.includes("ADR-0100") &&
  content.includes("Index Test ADR") &&
  content.includes("Accepted")
) {
  console.log("Test 2 — Index content populated: PASS");
} else {
  console.error("Test 2 — Index content missing expected ADR fields: FAIL");
  process.exit(1);
}

console.log("\nAll adr-index.smoke.js tests passed.\n");
