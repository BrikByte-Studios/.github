#!/usr/bin/env node
/**
 * Tiny smoke tests for ADR Linter (no Jest/Mocha required).
 *
 * Validates:
 *  - Valid ADR passes
 *  - ADR missing required field fails
 *  - Duplicate ID fails
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TMP = path.join(__dirname, ".tmp-tests");
const SCHEMA = path.join(__dirname, "../..", "docs", "adr", "adr.schema.json");
const LINTER = path.join(__dirname, "../..", "scripts", "adr", "adr-lint.js");

function write(p, c) {
  const file = path.join(TMP, p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c, "utf-8");
  return file;
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: "pipe" });
    return { ok: true, out: "" };
  } catch (err) {
    return { ok: false, out: err.stdout?.toString() || err.message };
  }
}

// Clean + setup
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
fs.mkdirSync(TMP);

// ------------------------
// 1) VALID ADR SHOULD PASS
// ------------------------
write(
  "docs/adr/001-valid.md",
  `---
id: "ADR-0001"
seq: 1
title: "Valid ADR"
status: "Proposed"
date: "2025-01-01"
authors: [ "@dev" ]
area: [ "PIPE" ]
---

# Valid ADR
`
);

const valid = run(
  `node "${LINTER}" --glob "${TMP}/docs/adr/001-valid.md" --schema "${SCHEMA}"`
);

console.log("Test 1 — Valid ADR should pass:", valid.ok ? "PASS" : "FAIL");

if (!valid.ok) {
  console.error(valid.out);
  process.exit(1);
}

// -----------------------------------------
// 2) MISSING FIELD (status) SHOULD FAIL
// -----------------------------------------
write(
  "docs/adr/002-missing-status.md",
  `---
id: "ADR-0002"
seq: 2
title: "Missing Status"
date: "2025-01-01"
authors: [ "@dev" ]
area: [ "PIPE" ]
---

# Invalid ADR
`
);

const missingStatus = run(
  `node "${LINTER}" --glob "${TMP}/docs/adr/002-missing-status.md" --schema "${SCHEMA}"`
);

console.log(
  "Test 2 — ADR missing required 'status' should fail:",
  !missingStatus.ok ? "PASS" : "FAIL"
);

if (missingStatus.ok) {
  console.error("Expected failure but linter passed.");
  process.exit(1);
}

// -----------------------------------------
// 3) DUPLICATE ID SHOULD FAIL
// -----------------------------------------

write(
  "docs/adr/003-dup-1.md",
  `---
id: "ADR-0003"
seq: 3
title: "Dup1"
status: "Proposed"
date: "2025-01-01"
authors: [ "@dev" ]
area: [ "PIPE" ]
---
`
);

write(
  "docs/adr/004-dup-2.md",
  `---
id: "ADR-0003"   # SAME ID AS ABOVE
seq: 4
title: "Dup2"
status: "Proposed"
date: "2025-01-01"
authors: [ "@dev" ]
area: [ "PIPE" ]
---
`
);

const dup = run(
  `node "${LINTER}" --glob "${TMP}/docs/adr/*.md" --schema "${SCHEMA}"`
);

console.log(
  "Test 3 — Duplicate ID should fail:",
  !dup.ok ? "PASS" : "FAIL"
);

if (dup.ok) {
  console.error("Expected duplicate ID failure but linter passed.");
  process.exit(1);
}

console.log("\nAll adr-lint.smoke.js tests passed.\n");
