#!/usr/bin/env node
/**
 * Smoke Test: Valid policy.yml should PASS
 *
 * This verifies that the validator script:
 *   - Loads and validates the schema
 *   - Correctly accepts a valid policy.yml
 *   - Exits with code 0
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Resolve repo root (two levels up)
const repoRoot = path.resolve(__dirname, "..", "..");

// TMP location for this test
const tmpDir = path.join(__dirname, ".tmp-policy-valid");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ---------------------
// 1) Prepare test files
// ---------------------

// VALID policy.yml
const validPolicy = `
policy_version: "1.0.0"
mode: "advisory"

reviews:
  required_approvals: 2
  require_code_owner_review: true
  additional_reviewer_teams:
    - "platform-leads"

tests:
  coverage_min: 80
  require_tests_green: true
  critical_paths_only: false

security:
  sast_threshold: "no-high"
  sca_threshold: "no-critical"
  dast_threshold: "no-critical"

docs:
  require_docs_on_feature_change: true
  paths:
    - "docs/**"

supply_chain:
  require_signed_artifacts: true
  require_sbom: true
`;

const policyPath = path.join(tmpDir, "policy.yml");
fs.writeFileSync(policyPath, validPolicy);

// ---------------------
// 2) Run validator
// ---------------------

const validator = path.join(repoRoot, "scripts", "policy", "policy-validate.js");
const schema = path.join(repoRoot, "docs", "policy", "policy.schema.json");

try {
  execSync(
    `node "${validator}" --schema "${schema}" --file "${policyPath}"`,
    { stdio: "pipe" }
  );

  console.log("✓ Test (policy-valid.smoke.js): Valid policy passes as expected.");
  process.exit(0);

} catch (err) {
  console.error("✗ FAIL (policy-valid.smoke.js): Valid policy should have passed.");
  console.error(err.stdout?.toString() || err.message);
  process.exit(1);
}
