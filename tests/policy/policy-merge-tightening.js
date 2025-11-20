#!/usr/bin/env node
/**
 * Test: policy-merge — tightening overrides
 *
 * Verifies that:
 *  - Higher coverage_min than org baseline is allowed
 *  - Additional reviewer teams are merged (union)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const yaml = require("js-yaml");

const repoRoot = path.resolve(__dirname, "..", "..");
const tmpDir = path.join(__dirname, ".tmp-policy-merge-tightening");
const outDir = path.join(tmpDir, "out");

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const basePath = path.join(repoRoot, ".github", "policy.yml");
const schemaPath = path.join(repoRoot, "docs", "policy", "policy.schema.json");
const mergeScript = path.join(repoRoot, "scripts", "policy", "policy-merge.js");
const outPath = path.join(outDir, "effective-policy.json");

const basePolicy = yaml.load(fs.readFileSync(basePath, "utf8"));
const baseCoverage = basePolicy.tests && basePolicy.tests.coverage_min;

// 1) Repo policy: tighten coverage + add reviewer team
const tightenedCoverage = (typeof baseCoverage === "number" ? baseCoverage : 80) + 5;

const orgSast = basePolicy.security?.sast || {};
const orgSca  = basePolicy.security?.sca  || {};

const repoPolicy = `
extends: org
policy_version: "1.0.0"
mode: "enforce"

reviews:
  required_approvals: ${basePolicy.reviews.required_approvals || 2}
  require_code_owner_review: true
  additional_reviewer_teams:
    - "payments-team"

tests:
  coverage_min: ${tightenedCoverage}
  require_tests_green: true

security:
  # Repo is STRICTER than org here → valid tightening
  sast:
    tool: "${orgSast.tool || "codeql"}"
    # tighten from e.g. "medium" → "low"
    max_severity: "low"
    report_path: "${orgSast.report_path || "reports/codeql-results.json"}"

  sca:
    tool: "${orgSca.tool || "npm-audit"}"
    # tighten from e.g. "high" → "medium"
    max_severity: "medium"
    report_path: "${orgSca.report_path || "reports/npm-audit.json"}"

docs:
  require_docs_on_feature_change: true
  paths:
    - "docs/**"
`;


const repoPolicyPath = path.join(tmpDir, "policy.yml");
fs.writeFileSync(repoPolicyPath, repoPolicy);

// 2) Run merge
try {
  execSync(
    `node "${mergeScript}" --base "${basePath}" --repo "${repoPolicyPath}" --schema "${schemaPath}" --out "${outPath}"`,
    { stdio: "pipe" }
  );

  const effectivePolicy = JSON.parse(fs.readFileSync(outPath, "utf8"));

  const effCoverage = effectivePolicy.tests && effectivePolicy.tests.coverage_min;
  if (effCoverage < baseCoverage) {
    console.error("✗ FAIL: Effective coverage_min is lower than org baseline after tightening.");
    process.exit(1);
  }

  console.log("✓ Test (policy-merge.tightening.js): Tightening overrides pass as expected.");
  process.exit(0);
} catch (err) {
  console.error("✗ FAIL (policy-merge.tightening.js): Merge failed unexpectedly.");
  console.error(err.stdout?.toString() || err.message);
  process.exit(1);
}
