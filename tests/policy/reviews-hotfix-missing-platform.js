#!/usr/bin/env node
/**
 * Smoke test — eval-reviews.mjs
 *
 * Scenario:
 *   Branch: hotfix/urgent-123
 *   Policy: requires 2 approvals and ≥1 from platform-leads
 *   Evidence: 2 approvals, but none from platform-leads
 *
 * Expected:
 *   - eval-reviews exits non-zero
 *   - decision.reviews.result === "fail"
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(__dirname, ".tmp-reviews-hotfix-missing-platform");

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
      additional_reviewer_teams: [],
      default: {
        required_approvals: 2,
        require_code_owner_review: true,
        required_roles: []
      },
      branches: {
        "hotfix/*": {
          required_approvals: 2,
          required_roles: ["platform-leads"]
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
    branch: "hotfix/urgent-123",
    pr_number: 108,
    approvals: [
      {
        user: "alice",
        teams: ["backend-team"],
        author_association: "MEMBER"
      },
      {
        user: "bob",
        teams: ["frontend-team"],
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

    console.error(
      "✗ FAIL (reviews-hotfix-missing-platform): Gate unexpectedly passed without platform-leads approval."
    );
    process.exit(1);
  } catch (err) {
    const status = err.status;
    if (status === 0) {
      console.error(
        "✗ FAIL (reviews-hotfix-missing-platform): eval-reviews exited with code 0 but should have failed."
      );
      process.exit(1);
    }

    try {
      const raw = fs.readFileSync(decisionPath, "utf8");
      const decision = JSON.parse(raw);
      const result = decision.reviews && decision.reviews.result;
      if (result !== "fail") {
        console.error(
          `✗ FAIL (reviews-hotfix-missing-platform): expected decision.reviews.result === "fail", got ${result}`
        );
        process.exit(1);
      }
    } catch {
      console.warn(
        "⚠️ WARN (reviews-hotfix-missing-platform): could not read/parse decision.json; relying on non-zero exit."
      );
    }

    console.log(
      "✓ PASS (reviews-hotfix-missing-platform): Gate failed as expected when hotfix lacks platform-leads approval."
    );
  }
}

setup();
run();
