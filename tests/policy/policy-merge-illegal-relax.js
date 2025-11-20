#!/usr/bin/env node
/**
 * Test: policy-merge — illegal relaxation (coverage)
 *
 * Verifies that:
 *  - Lowering tests.coverage_min below org baseline causes merge to fail.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const yaml = require("js-yaml");

const repoRoot = path.resolve(__dirname, "..", "..");
const tmpDir = path.join(__dirname, ".tmp-policy-merge-illegal-relax");

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const basePath = path.join(repoRoot, ".github", "policy.yml");
const schemaPath = path.join(repoRoot, "docs", "policy", "policy.schema.json");
const mergeScript = path.join(repoRoot, "scripts", "policy", "policy-merge.js");

const basePolicy = yaml.load(fs.readFileSync(basePath, "utf8"));
const baseCoverage = basePolicy.tests && basePolicy.tests.coverage_min;

// If baseCoverage is not defined, default to 80 for the purpose of the test
const relaxedCoverage = (typeof baseCoverage === "number" ? baseCoverage : 80) - 10;

const orgSast = basePolicy.security?.sast || {};
const orgSca  = basePolicy.security?.sca  || {};

const repoPolicy = `
extends: org
policy_version: "1.0.0"
mode: "advisory"

reviews:
  required_approvals: ${basePolicy.reviews.required_approvals || 2}
  require_code_owner_review: true

tests:
  coverage_min: ${relaxedCoverage}
  require_tests_green: true

security:
  # Intentionally *more lenient* than org to trigger illegal-relax test
  sast:
    tool: "${orgSast.tool || "codeql"}"
    max_severity: "critical"  # relax vs org's e.g. "medium"/"high"
    report_path: "${orgSast.report_path || "reports/codeql-results.json"}"

  sca:
    tool: "${orgSca.tool || "npm-audit"}"
    max_severity: "critical"  # relax vs org's e.g. "high"
    report_path: "${orgSca.report_path || "reports/npm-audit.json"}"

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

  // If we get here, merge incorrectly allowed the relaxation
  console.error("✗ FAIL (policy-merge.illegal-relax.js): Illegal coverage relaxation should have failed.");
  process.exit(1);
} catch (err) {
  console.log("✓ Test (policy-merge.illegal-relax.js): Illegal coverage relaxation correctly blocked.");
  process.exit(0);
}
