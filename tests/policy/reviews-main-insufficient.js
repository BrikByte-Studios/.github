#!/usr/bin/env node
/**
 * Smoke test — eval-reviews.mjs
 *
 * Scenario:
 *   Branch: main
 *   Policy: requires 2 approvals
 *   Evidence: only 1 approval
 *
 * Expected:
 *   - eval-reviews exits non-zero
 *   - decision.reviews.result === "fail"
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(__dirname, ".tmp-reviews-main-insufficient");

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
    pr_number: 42,
    approvals: [
      {
        user: "alice",
        teams: ["platform-leads"],
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
      "✗ FAIL (reviews-main-insufficient): Gate unexpectedly passed with only 1 approval."
    );
    process.exit(1);
  } catch (err) {
    // Non-zero exit is expected.
    const status = err.status;
    if (status === 0) {
      console.error(
        "✗ FAIL (reviews-main-insufficient): eval-reviews exited with code 0 but should have failed."
      );
      process.exit(1);
    }

    // Optional: inspect decision.json for result === "fail"
    try {
      const raw = fs.readFileSync(decisionPath, "utf8");
      const decision = JSON.parse(raw);
      const result = decision.reviews && decision.reviews.result;
      if (result !== "fail") {
        console.error(
          `✗ FAIL (reviews-main-insufficient): expected decision.reviews.result === "fail", got ${result}`
        );
        process.exit(1);
      }
    } catch {
      console.warn(
        "⚠️ WARN (reviews-main-insufficient): could not read/parse decision.json; relying on non-zero exit."
      );
    }

    console.log("✓ PASS (reviews-main-insufficient): Gate failed as expected for insufficient approvals.");
  }
}

setup();
run();
