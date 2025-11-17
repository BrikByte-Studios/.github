#!/usr/bin/env node
/**
 * Test: policy-merge — unknown field rejected
 *
 * Verifies that:
 *  - A repo policy containing a top-level unknown field violates schema
 *    and causes the merge to fail.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const tmpDir = path.join(__dirname, ".tmp-policy-merge-unknown-field");

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const basePath = path.join(repoRoot, ".github", "policy.yml");
const schemaPath = path.join(repoRoot, "docs", "policy", "policy.schema.json");
const mergeScript = path.join(repoRoot, "scripts", "policy", "policy-merge.js");

const repoPolicy = `
extends: org
policy_version: "1.0.0"
mode: "advisory"

weird_magic_flag: true  # <-- not in schema, should fail

reviews:
  required_approvals: 2
  require_code_owner_review: true

tests:
  coverage_min: 80
  require_tests_green: true

security:
  sast_threshold: "no-high"
  sca_threshold: "no-critical"
  dast_threshold: "no-critical"

docs:
  require_docs_on_feature_change: true
`;

const repoPolicyPath = path.join(tmpDir, "policy.yml");
fs.writeFileSync(repoPolicyPath, repoPolicy);

try {
  execSync(
    `node "${mergeScript}" --base "${basePath}" --repo "${repoPolicyPath}" --schema "${schemaPath}"`,
    { stdio: "pipe" }
  );

  console.error("✗ FAIL (policy-merge.unknown-field.js): Unknown field should have caused schema validation to fail.");
  process.exit(1);
} catch (err) {
  console.log("✓ Test (policy-merge.unknown-field.js): Unknown field correctly rejected by schema.");
  process.exit(0);
}
