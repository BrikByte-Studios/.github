/**
 * BrikByte Studios — Coverage Gate Utilities (PIPE-GOV-7.3.2)
 *
 * Pure helper functions used by the coverage policy gate:
 *   - readCoverageReport: load JSON coverage report from disk
 *   - extractCoveragePercent: safely extract an overall coverage %
 *   - evaluateCoveragePolicy: apply absolute and delta rules
 *
 * These functions are intentionally side-effect free (no logging, no process.exit)
 * so they can be:
 *   - unit tested easily
 *   - reused by different gate entrypoints (CI, CLI, local checks)
 */

const fs = require("fs");
const path = require("path");

/**
 * Read a JSON file from disk and return the parsed object.
 *
 * @param {string} reportPath - Absolute or relative path to JSON report.
 * @returns {object} Parsed JSON object.
 * @throws {Error} If the file cannot be read or parsed.
 */
function readCoverageReport(reportPath) {
  const abs = path.resolve(reportPath);
  const raw = fs.readFileSync(abs, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse coverage JSON at "${abs}": ${err.message}`
    );
  }
}

/**
 * Safe nested getter. Given an object and a path array, returns the nested value
 * or undefined if any segment is missing.
 *
 * @param {object} obj
 * @param {string[]} segments
 * @returns {*}
 */
function getNested(obj, segments) {
  return segments.reduce(
    (acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined),
    obj
  );
}

/**
 * Extract an overall coverage percentage from a coverage summary object.
 *
 * Default assumption: Jest/Istanbul-style coverage summary:
 * {
 *   "total": {
 *     "lines": { "pct": 82.35 },
 *     ...
 *   }
 * }
 *
 * We try in order:
 *   total.lines.pct
 *   total.statements.pct
 *   total.branches.pct
 *   total.functions.pct
 *
 * @param {object} summary - Parsed coverage summary JSON.
 * @returns {number} coverage percentage (0–100).
 * @throws {Error} If no known coverage metric can be found.
 */
function extractCoveragePercent(summary) {
  const candidatePaths = [
    ["total", "lines", "pct"],
    ["total", "statements", "pct"],
    ["total", "branches", "pct"],
    ["total", "functions", "pct"]
  ];

  for (const pathArr of candidatePaths) {
    const v = getNested(summary, pathArr);
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }

  throw new Error(
    "Unable to extract coverage percentage. Expected one of total.lines.pct, total.statements.pct, total.branches.pct, total.functions.pct."
  );
}

/**
 * Evaluate coverage against policy rules (absolute + delta).
 *
 * @param {object} params
 * @param {object} params.orgTests - Org-level tests policy (from .github/policy.yml).
 * @param {object} params.effectiveTests - Effective tests policy for this repo/branch.
 * @param {number} params.coverageCurrent - Current coverage % (0–100).
 * @param {number|null} [params.coverageBaseline] - Baseline coverage % (0–100) or null if unknown.
 * @returns {object} coverage decision block ready for decision.json:
 *   {
 *     coverage_current,
 *     coverage_baseline,
 *     coverage_min,
 *     coverage_delta_min,
 *     delta,
 *     result,
 *     reason
 *   }
 */
function evaluateCoveragePolicy({
  orgTests,
  effectiveTests,
  coverageCurrent,
  coverageBaseline = null
}) {
  const orgMin =
    orgTests && typeof orgTests.coverage_min === "number"
      ? orgTests.coverage_min
      : 0;
  const repoMin =
    effectiveTests && typeof effectiveTests.coverage_min === "number"
      ? effectiveTests.coverage_min
      : 0;

  // Non-relaxable baseline: effective_min = max(org_min, repo_min)
  const coverageMin = Math.max(orgMin, repoMin);

  const deltaMin =
    effectiveTests && typeof effectiveTests.coverage_delta_min === "number"
      ? effectiveTests.coverage_delta_min
      : null;

  let result = "pass";
  let reason = null;
  let delta = null;

  // Absolute coverage check
  if (typeof coverageCurrent !== "number" || !Number.isFinite(coverageCurrent)) {
    result = "fail";
    reason = "Coverage current value is missing or invalid.";
  } else if (coverageCurrent < coverageMin) {
    result = "fail";
    reason = `Coverage ${coverageCurrent}% below minimum ${coverageMin}%.`;
  }

  // Delta check if we still pass absolute check or want to enrich reason
  if (
    result === "pass" &&
    coverageBaseline != null &&
    typeof deltaMin === "number"
  ) {
    delta = coverageCurrent - coverageBaseline;
    if (delta < deltaMin) {
      result = "fail";
      reason = `Coverage delta ${delta.toFixed(
        2
      )}pp below allowed minimum delta ${deltaMin}pp (current ${coverageCurrent}%, baseline ${coverageBaseline}%).`;
    }
  } else if (coverageBaseline != null && typeof deltaMin === "number") {
    // Still compute delta for evidence even if absolute check failed
    delta = coverageCurrent - coverageBaseline;
  }

  return {
    coverage_current: coverageCurrent,
    coverage_baseline: coverageBaseline,
    coverage_min: coverageMin,
    coverage_delta_min: deltaMin,
    delta,
    result,
    reason
  };
}

module.exports = {
  readCoverageReport,
  extractCoveragePercent,
  evaluateCoveragePolicy
};
