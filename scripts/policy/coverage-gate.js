#!/usr/bin/env node
/**
 * BrikByte Studios — Coverage Policy Gate (PIPE-GOV-7.3.2)
 *
 * CLI entrypoint used by CI to enforce minimum test coverage based on policy.
 *
 * Responsibilities:
 *   1. Load org-level policy (.github/policy.yml) and effective merged policy (JSON/YAML).
 *   2. Load coverage summary JSON (coverage_report_path or explicit CLI arg).
 *   3. Optionally load baseline coverage summary (for delta checks).
 *   4. Evaluate coverage against policy using evaluateCoveragePolicy().
 *   5. Merge coverage decision into decision.json (if provided) and write it out.
 *   6. Exit 0 on pass, non-zero on fail.
 *
 * This script is intentionally:
 *   - simple to call from GitHub Actions
 *   - verbose in its error messages for debugging in CI logs
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const {
  readCoverageReport,
  extractCoveragePercent,
  evaluateCoveragePolicy
} = require("./coverage-utils");

// -------- CLI ARG PARSER ----------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.replace(/^--/, "");
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

// -------- FILE HELPERS ------------------------------------------------------

function loadYamlOrJson(filePath) {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, "utf8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw);
  }
  return yaml.load(raw);
}

function loadIfExists(filePath) {
  if (!filePath) return null;
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return null;
  const raw = fs.readFileSync(abs, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    // Not fatal for baseline; caller can decide.
    return null;
  }
}

// -------- MAIN LOGIC --------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  const orgPolicyPath = args["org-policy"] || ".github/policy.yml";
  const effectivePolicyPath =
    args["effective-policy"] || "out/effective-policy.json";
  const coverageReportOverride = args["coverage-report"] || null;
  const baselineReportPath = args["baseline-report"] || null;
  const decisionInPath = args["decision-in"] || null;
  const decisionOutPath =
    args["decision-out"] || decisionInPath || "out/decision.json";

  try {
    // 1) Load policies
    const orgPolicy = loadYamlOrJson(orgPolicyPath);
    const effectivePolicy = loadYamlOrJson(effectivePolicyPath);

    const orgTests = orgPolicy.tests || {};
    const effectiveTests = effectivePolicy.tests || {};

    // Determine report path: CLI override > policy.tests.coverage_report_path
    const reportPath =
      coverageReportOverride || effectiveTests.coverage_report_path;

    if (!reportPath) {
      throw new Error(
        "No coverage report path configured. Set tests.coverage_report_path in policy or pass --coverage-report."
      );
    }

    // 2) Load coverage summary (current)
    const summary = readCoverageReport(reportPath);
    const coverageCurrent = extractCoveragePercent(summary);

    // 3) Optional baseline coverage
    let coverageBaseline = null;
    if (baselineReportPath) {
      const baselineSummary = loadIfExists(baselineReportPath);
      if (baselineSummary) {
        coverageBaseline = extractCoveragePercent(baselineSummary);
      }
    }

    // 4) Evaluate coverage vs policy
    const coverageDecision = evaluateCoveragePolicy({
      orgTests,
      effectiveTests,
      coverageCurrent,
      coverageBaseline
    });

    // 5) Merge into decision.json
    let decision = {};
    if (decisionInPath && fs.existsSync(path.resolve(decisionInPath))) {
      const raw = fs.readFileSync(path.resolve(decisionInPath), "utf8");
      decision = JSON.parse(raw);
    }

    if (!decision.meta) {
      decision.meta = {};
    }
    if (!decision.meta.gates) {
      decision.meta.gates = [];
    }
    decision.coverage = {
      ...coverageDecision,
      coverage_report_path: reportPath
    };
    decision.meta.gates.push("coverage");

    const outDir = path.dirname(path.resolve(decisionOutPath));
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(
      path.resolve(decisionOutPath),
      JSON.stringify(decision, null, 2),
      "utf8"
    );

    // 6) Exit status + log
    if (coverageDecision.result === "fail") {
      console.error(
        `❌ Coverage gate failed: ${coverageDecision.reason || "Unknown reason"}`
      );
      process.exit(1);
    }

    console.log(
      `✅ Coverage gate passed. Coverage: ${coverageDecision.coverage_current}% (min ${coverageDecision.coverage_min}%).`
    );
    if (
      coverageDecision.coverage_baseline != null &&
      coverageDecision.delta != null
    ) {
      console.log(
        `   Baseline: ${coverageDecision.coverage_baseline}% (delta ${coverageDecision.delta.toFixed(
          2
        )}pp, allowed delta ${coverageDecision.coverage_delta_min}pp).`
      );
    }
  } catch (err) {
    console.error(`❌ coverage-gate error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
