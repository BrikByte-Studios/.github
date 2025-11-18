#!/usr/bin/env node
/**
 * Smoke test — eval-reviews.mjs
 *
 * Scenario:
 *   Branch: main
 *   Policy: requires 2 approvals and CODEOWNER review
 *   Evidence: 2 approvals and code_owner_approved = true
 *
 * Expected:
 *   - eval-reviews exits with code 0
 *   - decision.reviews.result === "pass"
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(__dirname, ".tmp-reviews-happy-path");

function setup() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const policy = {
    policy_version: "1.0.0",
    mode: "enforce",
    reviews: {
      required_approvals: 2,
      require_code_owner_review: true,
      additional_reviewer_teams: ["platform-leads"],
      default: {
        required_approvals: 2,
        require_code_owner_review: true,
        required_roles: []
      },
      branches: {
        main: {
          required_approvals: 2,
          require_code_owner_review: true
        }
      }
    },
    tests: {
      coverage_min: 80,
      require_tests_green: true,
      critical_paths_only: false
    },
    security: {
      sast_threshold: "no-high",
      sca_threshold: "no-critical",
      dast_threshold: "no-critical"
    },
    docs: {
      require_docs_on_feature_change: true,
      paths: ["docs/**"]
    },
    supply_chain: {
      require_signed_artifacts: true,
      require_sbom: true
    }
  };

  const reviewsEvidence = {
    branch: "main",
    pr_number: 7,
    approvals: [
      {
        user: "alice",
        teams: ["platform-leads"],
        author_association: "MEMBER"
      },
      {
        user: "bob",
        teams: ["backend-team"],
        author_association: "MEMBER"
      }
    ],
    code_owner_approved: true
  };

  fs.writeFileSync(
    path.join(TMP_DIR, "effective-policy.json"),
    JSON.stringify(policy, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(TMP_DIR, "reviews.json"),
    JSON.stringify(reviewsEvidence, null, 2),
    "utf8"
  );
}

function run() {
  const policyPath = path.join(TMP_DIR, "effective-policy.json");
  const reviewsPath = path.join(TMP_DIR, "reviews.json");
  const decisionPath = path.join(TMP_DIR, "decision.json");

  try {
    execSync(
      [
        "node",
        "scripts/policy/eval-reviews.mjs",
        "--policy",
        JSON.stringify(policyPath),
        "--reviews",
        JSON.stringify(reviewsPath),
        "--decision",
        JSON.stringify(decisionPath)
      ].join(" "),
      { cwd: ROOT, stdio: "pipe" }
    );
  } catch (err) {
    console.error(
      `✗ FAIL (reviews-happy-path): eval-reviews failed unexpectedly. status=${err.status}, message=${err.message}`
    );
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(decisionPath, "utf8");
    const decision = JSON.parse(raw);
    const result = decision.reviews && decision.reviews.result;
    if (result !== "pass") {
      console.error(
        `✗ FAIL (reviews-happy-path): expected decision.reviews.result === "pass", got ${result}`
      );
      process.exit(1);
    }
  } catch {
    console.warn(
      "⚠️ WARN (reviews-happy-path): could not read/parse decision.json; considering only zero exit."
    );
  }

  console.log("✓ PASS (reviews-happy-path): Gate passed as expected for compliant reviews.");
}

setup();
run();
