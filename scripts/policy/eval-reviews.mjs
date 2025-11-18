#!/usr/bin/env node
/**
 * BrikByte Studios — Reviews Evaluator (PIPE-GOV-7.3.1)
 *
 * Purpose:
 *   Given:
 *     - An effective policy (merged org + repo policy)
 *     - Gathered review evidence for a PR
 *
 *   This script:
 *     - Resolves the applicable review rule for the PR branch
 *     - Compares required approvals vs actual approvals
 *     - Checks CODEOWNER requirement and required_roles
 *     - Writes a `reviews` section into decision.json
 *     - Exits non-zero if requirements are not met
 *
 * Usage:
 *   node scripts/policy/eval-reviews.mjs \
 *     --policy .audit/<run>/effective-policy.json \
 *     --reviews .audit/<run>/reviews.json \
 *     --decision .audit/<run>/decision.json
 */

import fs from "fs";
import path from "path";

// ------------------ CLI ARG PARSER ------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.replace(/^--/, "");
    const next = argv[i + 1];
    const val = next && !next.startsWith("--") ? (i++, next) : true;
    args[key] = val;
  }
  return args;
}

// ------------------ HELPERS -------------------------------------------------

/**
 * Simple branch pattern matcher.
 *
 * Supports:
 *   - Exact match: "main"
 *   - Glob suffix: "release/*", "hotfix/*", "feature/*"
 */
function matchesPattern(branch, pattern) {
  if (pattern === branch) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2); // remove "/*"
    return branch === prefix || branch.startsWith(`${prefix}/`);
  }
  return false;
}

/**
 * Selects the most specific review rule for a branch:
 *   1. Exact match in reviews.branches
 *   2. First wildcard match (in insertion order)
 *   3. reviews.default (if present)
 *   4. Fallback to flattened baseline (required_approvals / require_code_owner_review)
 */
function selectReviewRule(branch, reviews) {
  const branches = reviews.branches || {};
  const patterns = Object.keys(branches);

  // Exact match first
  for (const pattern of patterns) {
    if (pattern === branch) {
      return {
        source: `branches.${pattern}`,
        rule: branches[pattern]
      };
    }
  }

  // Wildcard patterns
  for (const pattern of patterns) {
    if (pattern.endsWith("/*") && matchesPattern(branch, pattern)) {
      return {
        source: `branches.${pattern}`,
        rule: branches[pattern]
      };
    }
  }

  // Default rule
  if (reviews.default) {
    return {
      source: "default",
      rule: reviews.default
    };
  }

  // Fallback: flattened baseline
  const baseline = {};
  if (typeof reviews.required_approvals === "number") {
    baseline.required_approvals = reviews.required_approvals;
  }
  if (typeof reviews.require_code_owner_review === "boolean") {
    baseline.require_code_owner_review = reviews.require_code_owner_review;
  }
  return {
    source: "baseline",
    rule: baseline
  };
}

/**
 * Returns true if at least one approval is from one of the required roles.
 */
function hasRequiredRole(approvals, requiredRoles) {
  if (!requiredRoles || requiredRoles.length === 0) return true; // nothing to enforce
  for (const approval of approvals) {
    const teams = approval.teams || [];
    if (teams.some((t) => requiredRoles.includes(t))) {
      return true;
    }
  }
  return false;
}

/**
 * Loads JSON or YAML; here we assume JSON for effective policy and reviews.
 * (If you later want YAML for policy, you can inject js-yaml and detect extension.)
 */
function loadJsonFile(pathStr, label) {
  if (!fs.existsSync(pathStr)) {
    throw new Error(`${label} file not found: ${pathStr}`);
  }
  const raw = fs.readFileSync(pathStr, "utf8");
  return JSON.parse(raw);
}

// ------------------ MAIN ----------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const policyPath = args.policy;
  const reviewsPath = args.reviews;
  const decisionPath = args.decision || "decision.json";

  if (!policyPath) {
    console.error("❌ --policy is required (path to effective policy JSON).");
    process.exit(1);
  }
  if (!reviewsPath) {
    console.error("❌ --reviews is required (path to gathered reviews JSON).");
    process.exit(1);
  }

  const policy = loadJsonFile(policyPath, "Policy");
  const reviewsPolicy = policy.reviews;
  if (!reviewsPolicy) {
    console.log("ℹ️ No reviews section in policy; skipping review enforcement.");
    return 0;
  }

  const evidence = loadJsonFile(reviewsPath, "Reviews evidence");
  const branch = evidence.branch;
  const approvals = evidence.approvals || [];
  const actualApprovals = approvals.length;

  const { source, rule } = selectReviewRule(branch, reviewsPolicy);

  const requiredApprovals =
    typeof rule.required_approvals === "number"
      ? rule.required_approvals
      : reviewsPolicy.required_approvals;

  const requireCodeOwner =
    typeof rule.require_code_owner_review === "boolean"
      ? rule.require_code_owner_review
      : reviewsPolicy.require_code_owner_review;

  const requiredRoles = rule.required_roles || [];

  const codeOwnerApproved = evidence.code_owner_approved;
  const rolesSatisfied = hasRequiredRole(approvals, requiredRoles);

  let result = "pass";
  let reason = "All review requirements satisfied.";

  // --- Evaluation -----------------------------------------------------------
  if (requiredApprovals && actualApprovals < requiredApprovals) {
    result = "fail";
    reason = `Branch ${branch} requires ${requiredApprovals} approvals; got ${actualApprovals}.`;
  } else if (requireCodeOwner && !codeOwnerApproved) {
    result = "fail";
    reason = `Branch ${branch} requires at least one CODEOWNER approval.`;
  } else if (!rolesSatisfied) {
    result = "fail";
    reason = `Branch ${branch} requires ≥1 approval from roles [${requiredRoles.join(
      ", "
    )}], but none of the approvers matched.`;
  }

  const reviewDecision = {
    branch,
    rule_source: source,
    required_approvals: requiredApprovals ?? null,
    actual_approvals: actualApprovals,
    require_code_owner_review: requireCodeOwner ?? null,
    code_owner_approved: codeOwnerApproved,
    required_roles: requiredRoles,
    approvers: approvals,
    result,
    reason
  };

  // --- Merge into decision.json --------------------------------------------
  let decision = {};
  if (fs.existsSync(decisionPath)) {
    try {
      decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
    } catch {
      // If we can't parse, start fresh but keep file around for debugging.
      console.warn(
        `⚠️ Could not parse existing decision.json at ${decisionPath}; overwriting.`
      );
    }
  }

  decision.reviews = reviewDecision;

  const decisionDir = path.dirname(decisionPath);
  if (!fs.existsSync(decisionDir)) {
    fs.mkdirSync(decisionDir, { recursive: true });
  }
  fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2), "utf8");

  if (result === "fail") {
    console.error(`❌ Reviews gate failed: ${reason}`);
    process.exit(1);
  }

  console.log(`✅ Reviews gate passed for branch ${branch}.`);
  console.log(`   Required approvals: ${requiredApprovals}`);
  console.log(`   Actual approvals:   ${actualApprovals}`);
  process.exit(0);
}

main();
