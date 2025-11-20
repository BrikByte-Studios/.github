#!/usr/bin/env node
/**
 * Test: policy-merge — inherit-only (extends: org, no overrides)
 *
 * Verifies that:
 *  - A repo policy that only sets extends: org and policy_version
 *    merges cleanly.
 *  - The effective policy is identical to the org baseline.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const tmpDir = path.join(__dirname, ".tmp-policy-merge-inherit-only");
const outDir = path.join(tmpDir, "out");

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// 1) Prepare repo policy (inherit only)
const repoPolicy = `
extends: org
policy_version: "1.0.0"
mode: "advisory"

reviews:
  required_approvals: 2
  require_code_owner_review: true

tests:
  coverage_min: 80
  require_tests_green: true

security:
  sast:
    tool: "codeql"
    max_severity: "medium"
    report_path: "reports/codeql-results.json"
  sca:
    tool: "npm-audit"
    max_severity: "high"
    report_path: "reports/npm-audit.json"

docs:
  require_docs_on_feature_change: true
`;


const repoPolicyPath = path.join(tmpDir, "policy.yml");
fs.writeFileSync(repoPolicyPath, repoPolicy);

// 2) Run merge
const basePath = path.join(repoRoot, ".github", "policy.yml");
const schemaPath = path.join(repoRoot, "docs", "policy", "policy.schema.json");
const mergeScript = path.join(repoRoot, "scripts", "policy", "policy-merge.js");
const outPath = path.join(outDir, "effective-policy.json");

try {
  execSync(
    `node "${mergeScript}" --base "${basePath}" --repo "${repoPolicyPath}" --schema "${schemaPath}" --out "${outPath}"`,
    { stdio: "pipe" }
  );

  // 3) Compare effective policy with base
  const basePolicy = require("js-yaml").load(fs.readFileSync(basePath, "utf8"));
  const effectivePolicy = JSON.parse(fs.readFileSync(outPath, "utf8"));

  const baseJson = JSON.stringify(basePolicy);
  const effJson = JSON.stringify(effectivePolicy);

  if (baseJson !== effJson) {
    console.error("✗ FAIL: Effective policy does not match base policy for inherit-only case.");
    process.exit(1);
  }

  console.log("✓ Test (policy-merge.inherit-only.js): Effective policy matches base for inherit-only.");
  process.exit(0);
} catch (err) {
  console.error("✗ FAIL (policy-merge.inherit-only.js): Merge failed unexpectedly.");
  console.error(err.stdout?.toString() || err.message);
  process.exit(1);
}
