#!/usr/bin/env node
/**
 * =============================================================================
 * BrikByteOS — Coverage Governance Gate
 * -----------------------------------------------------------------------------
 * Task: [TASK] GOV-TEST-COVERAGE-POLICY-004
 *
 * Repos:
 *   - Implemented in:
 *       • BrikByte-Studios/.github (.github/scripts/coverage-check.mjs)
 *   - Consumed by:
 *       • BrikByte-Studios/brik-pipe-examples/* (example services)
 *       • Product repos via .github/workflows/coverage-check.yml
 *
 * Purpose:
 *   Enforce minimum coverage thresholds using:
 *     - coverage.json (normalized coverage from PIPE-TEST-COVERAGE-INTEG-003)
 *     - .governance/tests.yml (or .json) policy
 *
 * Behavior:
 *   - Compute overall coverage (summary.line).
 *   - Compute critical coverage for configured critical_paths.
 *   - Apply ignore_patterns to exclude noise (migrations/, generated/, etc).
 *   - Compare against thresholds:
 *       • coverage_min (overall)
 *       • critical_min (critical paths), if critical files exist.
 *   - Optionally read baseline from .audit/coverage-baseline.json (if present)
 *     and report delta: old → new (Δ +/- pp).
 *   - Exit non-zero if any threshold is violated.
 *
 *   This script is *governance*, not test execution. It assumes tests +
 *   coverage collection have already run successfully.
 *
 * Usage (CI example):
 *
 *   node .github/scripts/coverage-check.mjs \
 *     --coverage-file out/coverage.json \
 *     --policy-file .governance/tests.yml
 *
 * Arguments:
 *   --coverage-file <path>  (default: out/coverage.json)
 *   --policy-file   <path>  (default: .governance/tests.yml)
 *   --baseline-file <path>  (optional, default: .audit/coverage-baseline.json)
 *
 * Exit codes:
 *   0  - All thresholds satisfied
 *   1  - Threshold violation or unrecoverable error
 * =============================================================================
 */

import fs from "node:fs";
import path from "node:path";

/**
 * -----------------------------------------------------------------------------
 * CLI Argument Parsing
 * -----------------------------------------------------------------------------
 */

/**
 * Parse process.argv style arguments into a key/value map.
 *
 * Supports:
 *   --key=value
 *   --key value
 *   --flag         (boolean true)
 *
 * @param {string[]} argv - Raw arguments (excluding node + script)
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [rawKey, valueFromEq] = arg.split("=");
    const key = rawKey.replace(/^--/, "");

    if (valueFromEq !== undefined) {
      options[key] = valueFromEq;
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return options;
}

/**
 * -----------------------------------------------------------------------------
 * Logging Helpers
 * -----------------------------------------------------------------------------
 */

/**
 * Log informational messages with a consistent prefix.
 * @param {string} message
 */
function logInfo(message) {
  // eslint-disable-next-line no-console
  console.log(`[COVERAGE-GATE] ${message}`);
}

/**
 * Log warnings with a consistent prefix.
 * @param {string} message
 */
function logWarn(message) {
  // eslint-disable-next-line no-console
  console.warn(`[COVERAGE-GATE] WARNING: ${message}`);
}

/**
 * Log errors with a consistent prefix.
 * @param {string} message
 */
function logError(message) {
  // eslint-disable-next-line no-console
  console.error(`[COVERAGE-GATE] ERROR: ${message}`);
}

/**
 * -----------------------------------------------------------------------------
 * File & Parsing Utilities
 * -----------------------------------------------------------------------------
 */

/**
 * Check if a file exists without throwing.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely read a JSON file from disk.
 *
 * @param {string} filePath
 * @returns {any}
 */
function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * Minimal YAML parser for .governance/tests.yml format.
 *
 * Supported patterns:
 *   key: value
 *   key:
 *     - item1
 *     - item2
 *
 * Notes:
 *   - This is intentionally simple and tailored to the coverage policy schema.
 *   - For more advanced YAML needs, a dedicated parser can be introduced later.
 *
 * @param {string} filePath
 * @returns {Record<string, any>}
 */
function readSimpleYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  const result = {};
  let currentKey = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue; // skip comments and blank lines
    }

    // Array item: "- value"
    if (trimmed.startsWith("-")) {
      const value = trimmed.replace(/^-\s*/, "").replace(/^"(.*)"$/, "$1");
      if (currentKey) {
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }
        result[currentKey].push(value);
      }
      continue;
    }

    // Key/value: "key: value" or "key:"
    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();

      currentKey = key;

      if (!value) {
        // key:   (start of block / array)
        result[key] = result[key] ?? [];
      } else {
        // Strip quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        // Try parse number
        const numeric = Number(value);
        if (!Number.isNaN(numeric) && value !== "") {
          result[key] = numeric;
        } else {
          result[key] = value;
        }
      }
    }
  }

  return result;
}

/**
 * Read a policy file which may be YAML (.yml/.yaml) or JSON.
 *
 * @param {string} filePath
 * @returns {{
 *   coverage_min?: number,
 *   critical_min?: number,
 *   critical_paths?: string[],
 *   ignore_patterns?: string[]
 * }}
 */
function readPolicy(filePath) {
  if (!fileExists(filePath)) {
    throw new Error(`Coverage policy file not found at ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let policy;

  if (ext === ".json") {
    policy = readJsonFile(filePath);
  } else {
    policy = readSimpleYaml(filePath);
  }

  return {
    coverage_min: typeof policy.coverage_min === "number" ? policy.coverage_min : 0.8,
    critical_min: typeof policy.critical_min === "number" ? policy.critical_min : 0.9,
    critical_paths: Array.isArray(policy.critical_paths) ? policy.critical_paths : [],
    ignore_patterns: Array.isArray(policy.ignore_patterns) ? policy.ignore_patterns : [],
  };
}

/**
 * Compute a rounded percentage with the given number of decimals.
 *
 * @param {number|null|undefined} value
 * @param {number} [decimals=1]
 * @returns {number|null}
 */
function roundPct(value, decimals = 1) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Format a percentage for human-readable logs.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
function fmtPct(value) {
  return value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`;
}

/**
 * -----------------------------------------------------------------------------
 * Coverage Computation
 * -----------------------------------------------------------------------------
 */

/**
 * Infer overall coverage from coverage.json.
 *
 * @param {{
 *   summary?: { line?: number },
 *   files?: Array<{ path: string, line?: { covered?: number, total?: number, pct?: number } }>
 * }} coverage
 * @returns {number|null} overallPct
 */
function getOverallCoveragePct(coverage) {
  if (coverage.summary && typeof coverage.summary.line === "number") {
    return roundPct(coverage.summary.line);
  }

  // Fallback: aggregate from files if present
  if (Array.isArray(coverage.files) && coverage.files.length > 0) {
    let covered = 0;
    let total = 0;

    for (const file of coverage.files) {
      if (!file || !file.line) continue;

      const c = file.line.covered ?? null;
      const t = file.line.total ?? null;
      if (c === null || t === null || t <= 0) continue;

      covered += c;
      total += t;
    }

    if (total > 0) {
      return roundPct((covered / total) * 100);
    }
  }

  return null;
}

/**
 * Check if a given path should be ignored based on ignore_patterns.
 *
 * @param {string} filePath
 * @param {string[]} ignorePatterns
 * @returns {boolean}
 */
function isIgnoredPath(filePath, ignorePatterns) {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;
  return ignorePatterns.some((pattern) => filePath.includes(pattern));
}

/**
 * Compute aggregated coverage for "critical paths" from coverage.files.
 *
 * @param {{
 *   files?: Array<{ path: string, line?: { covered?: number, total?: number, pct?: number } }>
 * }} coverage
 * @param {string[]} criticalPaths
 * @param {string[]} ignorePatterns
 * @returns {{ pct: number|null, covered: number, total: number, count: number }}
 */
function getCriticalCoveragePct(coverage, criticalPaths, ignorePatterns) {
  if (!Array.isArray(coverage.files) || coverage.files.length === 0) {
    return {
      pct: null,
      covered: 0,
      total: 0,
      count: 0,
    };
  }

  if (!criticalPaths || criticalPaths.length === 0) {
    return {
      pct: null,
      covered: 0,
      total: 0,
      count: 0,
    };
  }

  let covered = 0;
  let total = 0;
  let count = 0;

  for (const file of coverage.files) {
    if (!file || !file.path || !file.line) continue;

    const filePath = file.path.replace(/\\/g, "/"); // normalize
    if (isIgnoredPath(filePath, ignorePatterns)) continue;

    const isCritical = criticalPaths.some((prefix) => filePath.startsWith(prefix));
    if (!isCritical) continue;

    const c = file.line.covered ?? null;
    const t = file.line.total ?? null;
    if (c === null || t === null || t <= 0) continue;

    covered += c;
    total += t;
    count += 1;
  }

  const pct = total > 0 ? roundPct((covered / total) * 100) : null;

  return { pct, covered, total, count };
}

/**
 * -----------------------------------------------------------------------------
 * Baseline (Previous Coverage) Support
 * -----------------------------------------------------------------------------
 */

/**
 * Read baseline coverage from a previous run if available.
 *
 * Contract:
 *   - Baseline file shape mirrors coverage.json:
 *     { summary: { line: 83.2 }, ... }
 *
 * @param {string} baselinePath
 * @returns {{ overallPct: number|null } | null}
 */
function tryReadBaseline(baselinePath) {
  if (!baselinePath || !fileExists(baselinePath)) {
    return null;
  }

  try {
    const baseline = readJsonFile(baselinePath);
    const overallPct = getOverallCoveragePct(baseline);
    return { overallPct };
  } catch (err) {
    logWarn(
      `Failed to parse baseline coverage from ${baselinePath}: ${
        err && err.message ? err.message : String(err)
      }`
    );
    return null;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Policy Evaluation
 * -----------------------------------------------------------------------------
 */

/**
 * Evaluate coverage against policy thresholds.
 *
 * @param {number|null} overallPct
 * @param {{ pct: number|null, count: number }} critical
 * @param {{ coverage_min: number, critical_min: number }} policy
 * @returns {{ violations: string[], summary: { overallPct: number|null, criticalPct: number|null } }}
 */
function evaluatePolicy(overallPct, critical, policy) {
  const violations = [];
  const { coverage_min, critical_min } = policy;

  if (overallPct === null) {
    violations.push(
      `Overall coverage is unavailable (summary.line is null). Cannot enforce coverage_min=${(
        coverage_min * 100
      ).toFixed(1)}%.`
    );
  } else if (overallPct < coverage_min * 100) {
    violations.push(
      `Overall coverage ${fmtPct(overallPct)} below minimum ${(coverage_min * 100).toFixed(
        1
      )}%.`
    );
  }

  // Only enforce critical thresholds if there are any critical files.
  if (critical.count > 0) {
    if (critical.pct === null) {
      violations.push(
        `Critical coverage is unavailable for ${critical.count} critical files. ` +
          `Cannot enforce critical_min=${(critical_min * 100).toFixed(1)}%.`
      );
    } else if (critical.pct < critical_min * 100) {
      violations.push(
        `Critical coverage ${fmtPct(critical.pct)} across ${critical.count} file(s) ` +
          `below minimum ${(critical_min * 100).toFixed(1)}%.`
      );
    }
  } else {
    logInfo("No files matched critical_paths; skipping critical_min enforcement.");
  }

  return {
    violations,
    summary: {
      overallPct,
      criticalPct: critical.pct,
    },
  };
}

/**
 * -----------------------------------------------------------------------------
 * Main Execution
 * -----------------------------------------------------------------------------
 */

(async function main() {
  const args = parseArgs(process.argv.slice(2));

  const coverageFile = args["coverage-file"] || "out/coverage.json";
  const policyFile = args["policy-file"] || ".governance/tests.yml";
  const baselineFile =
    args["baseline-file"] || path.join(".audit", "coverage-baseline.json");

  logInfo(`Coverage file : ${coverageFile}`);
  logInfo(`Policy file   : ${policyFile}`);
  logInfo(`Baseline file : ${baselineFile} (optional)`);

  if (!fileExists(coverageFile)) {
    logError(
      `coverage.json not found at ${coverageFile}. Did you run coverage-merge.mjs in this job?`
    );
    process.exit(1);
  }

  try {
    const coverage = readJsonFile(coverageFile);
    const policy = readPolicy(policyFile);

    const overallPct = getOverallCoveragePct(coverage);
    const critical = getCriticalCoveragePct(
      coverage,
      policy.critical_paths,
      policy.ignore_patterns
    );
    const baseline = tryReadBaseline(baselineFile);

    logInfo("---- Coverage Summary ----");
    if (baseline && baseline.overallPct !== null && overallPct !== null) {
      const delta = roundPct(overallPct - baseline.overallPct);
      const direction = delta >= 0 ? "+" : "";
      logInfo(
        `Overall coverage: ${fmtPct(
          baseline.overallPct
        )} → ${fmtPct(overallPct)} (Δ ${direction}${delta?.toFixed(1)}pp)`
      );
    } else if (overallPct !== null) {
      logInfo(
        `Overall coverage: ${fmtPct(
          overallPct
        )} (no prior baseline found; enforcing absolute thresholds only)`
      );
    } else {
      logWarn(
        "Overall coverage is n/a; summary.line missing in coverage.json. " +
          "Policy evaluation may fail."
      );
    }

    if (critical.count > 0) {
      logInfo(
        `Critical coverage: ${fmtPct(critical.pct)} across ${critical.count} file(s)`
      );
    } else {
      logInfo("Critical coverage: n/a (no files matched critical_paths).");
    }

    const { violations, summary } = evaluatePolicy(overallPct, critical, policy);

    if (violations.length === 0) {
      logInfo("✅ Coverage gate PASSED — all thresholds satisfied.");
      logInfo(
        `Details: overall=${fmtPct(summary.overallPct)}, critical=${fmtPct(
          summary.criticalPct
        )}`
      );
      process.exit(0);
    }

    logError("❌ Coverage gate FAILED. Violations:");
    for (const v of violations) {
      logError(`  - ${v}`);
    }

    process.exit(1);
  } catch (err) {
    logError(
      `Unexpected error while evaluating coverage policy: ${
        err && err.message ? err.message : String(err)
      }`
    );
    process.exit(1);
  }
})().catch((err) => {
  logError(
    `Fatal error in coverage governance script: ${
      err && err.message ? err.message : String(err)
    }`
  );
  process.exit(1);
});
