#!/usr/bin/env node
/**
 * Smoke Test: Invalid policy.yml should FAIL
 *
 * This verifies that the validator:
 *   - Rejects missing required fields
 *   - Produces errors
 *   - Exits with non-zero exit code
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Resolve repo root (two levels up)
const repoRoot = path.resolve(__dirname, "..", "..");

// TMP folder
const tmpDir = path.join(__dirname, ".tmp-policy-invalid");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ---------------------
// 1) Prepare test files
// ---------------------

// INVALID policy.yml — missing required fields (mode, reviews, tests, security, docs)
const invalidPolicy = `
policy_version: "1.0.0"

# missing: mode
# missing: reviews
# missing: tests
# missing: security
# missing: docs
# missing: supply_chain
`;

const policyPath = path.join(tmpDir, "policy.yml");
fs.writeFileSync(policyPath, invalidPolicy);

// ---------------------
// 2) Run validator (expect failure)
// ---------------------

const validator = path.join(repoRoot, "scripts", "policy", "policy-validate.js");
const schema = path.join(repoRoot, "docs", "policy", "policy.schema.json");

try {
  execSync(
    `node "${validator}" --schema "${schema}" --file "${policyPath}"`,
    { stdio: "pipe" }
  );

  // If we get here, test FAILED (should have errored)
  console.error("✗ FAIL (policy-invalid.smoke.js): Invalid policy should have failed validation.");
  process.exit(1);

} catch (err) {
  console.log("✓ Test (policy-invalid.smoke.js): Invalid policy failed as expected.");
  process.exit(0);
}
