#!/usr/bin/env node
/**
 * =============================================================================
 * BrikByteOS — Unit Test Audit Exporter
 * -----------------------------------------------------------------------------
 * Task / WBS:
 *   - [TASK] PIPE-TEST-AUDIT-EXPORT-005 — Integrate Test Result Parsers for
 *     .audit Exports
 *
 * Implemented in:
 *   - BrikByte-Studios/.github
 *     • Path: .github/actions/audit-export/export-unit-audit.mjs
 *
 * Consumed by:
 *   - BrikByte-Studios/brik-pipe-examples (example services)
 *   - Product repos using BrikByteOS test templates
 *
 * Purpose:
 *   Convert raw JUnit XML + normalized coverage.json + CI metadata into a
 *   structured audit bundle:
 *
 *     .audit/{timestamp}/unit-tests/
 *       ├─ results.json           # Parsed JUnit summary
 *       ├─ junit.xml              # Raw JUnit XML
 *       ├─ coverage-summary.json  # Distilled coverage summary
 *       └─ metadata.json          # CI + repo + runtime metadata
 *
 *   This bundle can be uploaded as a CI artifact or synced to an audit store
 *   for compliance, governance, and historical analysis.
 *
 * Usage (run inside the project root or working-directory):
 *
 *   node export-unit-audit.mjs \
 *     --junit "out/junit.xml" \
 *     --coverage "out/coverage.json" \
 *     --audit-root ".audit" \
 *     --runtime "node@20" \
 *     --duration-seconds "52"
 *
 * Notes:
 *   - Uses Node stdlib only; no external npm dependencies.
 *   - If JUnit or coverage are missing, emits stub JSON with a "reason".
 *   - Test success/failure is *not* decided here; this is an export layer.
 * =============================================================================
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Parse process.argv into an options map.
 *
 * Supports:
 *   --key value
 *   --key=value
 *
 * @param {string[]} argv - Command-line arguments (excluding node + script).
 * @returns {Record<string, string | boolean>} Parsed options map.
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
 * Log helper for informational messages.
 *
 * @param {string} message - Message to log.
 */
function logInfo(message) {
  // eslint-disable-next-line no-console
  console.log(`[COVERAGE-AUDIT] ${message}`);
}

/**
 * Log helper for warning messages.
 *
 * @param {string} message - Message to log.
 */
function logWarn(message) {
  // eslint-disable-next-line no-console
  console.warn(`[COVERAGE-AUDIT] WARNING: ${message}`);
}

/**
 * Log helper for error messages.
 *
 * @param {string} message - Message to log.
 */
function logError(message) {
  // eslint-disable-next-line no-console
  console.error(`[COVERAGE-AUDIT] ERROR: ${message}`);
}

/**
 * Check if a file exists.
 *
 * @param {string} filePath - Path to the file.
 * @returns {boolean} True if file exists, false otherwise.
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
 * Safely parse a string as a float.
 *
 * @param {string | undefined} value - Input string.
 * @param {number} [fallback=0] - Fallback value if parse fails.
 * @returns {number} Parsed float or fallback.
 */
function toFloat(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Safely parse a string as an integer.
 *
 * @param {string | undefined} value - Input string.
 * @param {number} [fallback=0] - Fallback value if parse fails.
 * @returns {number} Parsed integer or fallback.
 */
function toInt(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Generate a filesystem-safe timestamp string based on current time.
 *
 * Example:
 *   "2025-11-21T10:31:00.123Z" → "2025-11-21T10-31-00Z"
 *
 * @returns {string} Safe timestamp string for directory names.
 */
function makeSafeTimestamp() {
  const iso = new Date().toISOString(); // "2025-11-21T10:31:00.123Z"
  const trimmed = iso.replace(/\.\d+Z$/, "Z");
  return trimmed.replace(/:/g, "-");
}

/**
 * Parse a string of XML attributes into a map.
 *
 * Example:
 *   'name="Unit Tests" tests="10" failures="2"'
 *   → { name: "Unit Tests", tests: "10", failures: "2" }
 *
 * @param {string} attrString - Raw attribute string from <tag ...>.
 * @returns {Record<string, string>} Parsed attributes.
 */
function parseXmlAttributes(attrString) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = attrRegex.exec(attrString)) !== null) {
    const [, key, value] = match;
    attrs[key] = value;
  }
  return attrs;
}

/**
 * Parse JUnit XML content into a normalized summary structure.
 *
 * Supports:
 *   - Single <testsuite> root.
 *   - <testsuites> wrapper containing multiple <testsuite> elements.
 *
 * Result shape:
 *   {
 *     suites: [
 *       { name, tests, failures, errors, skipped, time }
 *     ],
 *     total:  { tests, failures, errors, skipped, time }
 *   }
 *
 * If XML cannot be parsed, returns a stub with reason in meta-like field.
 *
 * @param {string} xml - JUnit XML string.
 * @returns {{
 *   suites: Array<{
 *     name: string | null,
 *     tests: number,
 *     failures: number,
 *     errors: number,
 *     skipped: number,
 *     time: number
 *   }>,
 *   total: {
 *     tests: number,
 *     failures: number,
 *     errors: number,
 *     skipped: number,
 *     time: number
 *   },
 *   _rawSuitesCount?: number
 * }} Parsed JUnit summary.
 */
function parseJUnit(xml) {
  const suites = [];

  const suiteRegex = /<testsuite\b([^>]*)>/gi;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = suiteRegex.exec(xml)) !== null) {
    const [, rawAttrs] = match;
    const attrs = parseXmlAttributes(rawAttrs);

    const name = attrs.name || null;
    const tests = toInt(attrs.tests, 0);
    const failures = toInt(attrs.failures, 0);
    const errors = toInt(attrs.errors, 0);
    const skipped = toInt(attrs.skipped, 0);
    const time = toFloat(attrs.time, 0);

    suites.push({ name, tests, failures, errors, skipped, time });
  }

  if (suites.length === 0) {
    logWarn("No <testsuite> elements found in JUnit XML. Emitting stub summary.");
    return {
      suites: [],
      total: {
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0,
      },
      _rawSuitesCount: 0,
    };
  }

  const total = suites.reduce(
    (acc, suite) => ({
      tests: acc.tests + suite.tests,
      failures: acc.failures + suite.failures,
      errors: acc.errors + suite.errors,
      skipped: acc.skipped + suite.skipped,
      time: acc.time + suite.time,
    }),
    { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 }
  );

  return {
    suites,
    total,
    _rawSuitesCount: suites.length,
  };
}

/**
 * Extract coverage summary from a normalized coverage.json file.
 *
 * Expected coverage.json shape:
 *
 *   {
 *     "language": "node",
 *     "tool": "jest+c8",
 *     "summary": { "line": 86.3, "branch": 80.1 },
 *     "generated_at": "2025-11-21T10:30:00Z",
 *     "meta": { ... }
 *   }
 *
 * @param {string} coveragePath - Path to coverage.json.
 * @returns {{
 *   language: string | null,
 *   tool: string | null,
 *   summary: { line: number | null, branch?: number | null },
 *   generated_at: string | null,
 *   meta?: Record<string, unknown>
 * }} Coverage summary object.
 */
function extractCoverageSummary(coveragePath) {
  if (!coveragePath || !fileExists(coveragePath)) {
    logWarn(
      `coverage.json not found at ${coveragePath}. Emitting coverage-summary with line=null.`
    );
    return {
      language: null,
      tool: null,
      summary: { line: null },
      generated_at: null,
      meta: {
        reason: "coverage-json-missing",
        coverage_file: coveragePath || null,
      },
    };
  }

  try {
    const raw = fs.readFileSync(coveragePath, "utf8");
    const data = JSON.parse(raw);

    const language = data.language || null;
    const tool = data.tool || null;
    const summary = data.summary || {};
    const line = typeof summary.line === "number" ? summary.line : null;
    const branch =
      typeof summary.branch === "number" ? summary.branch : undefined;
    const generated_at = data.generated_at || null;

    return {
      language,
      tool,
      summary: { line, ...(branch !== undefined ? { branch } : {}) },
      generated_at,
      meta: data.meta || {},
    };
  } catch (err) {
    logWarn(
      `Failed to parse coverage.json at ${coveragePath}: ${
        (err && err.message) || err
      }. Emitting stub coverage-summary.`
    );
    return {
      language: null,
      tool: null,
      summary: { line: null },
      generated_at: null,
      meta: {
        reason: "coverage-json-parse-error",
        coverage_file: coveragePath,
      },
    };
  }
}

/**
 * Attempt to derive PR number from GitHub event payload when running in CI.
 *
 * Looks at:
 *   - GITHUB_EVENT_PATH JSON, expecting pull_request.number
 *
 * @returns {number | null} Pull request number or null if not available.
 */
function derivePrNumberFromGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fileExists(eventPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(eventPath, "utf8");
    const event = JSON.parse(raw);

    if (event.pull_request && event.pull_request.number) {
      return toInt(String(event.pull_request.number), null);
    }

    if (event.issue && event.issue.pull_request && event.issue.number) {
      return toInt(String(event.issue.number), null);
    }

    return null;
  } catch (err) {
    logWarn(
      `Failed to parse GITHUB_EVENT_PATH JSON for PR number: ${
        (err && err.message) || err
      }`
    );
    return null;
  }
}

/**
 * Derive a branch name from GitHub refs.
 *
 * Priority:
 *   1) GITHUB_REF_NAME (if present)
 *   2) Parsed from GITHUB_REF
 *
 * @returns {string | null} Branch-like name or null.
 */
function deriveBranchName() {
  const refName = process.env.GITHUB_REF_NAME;
  if (refName) return refName;

  const ref = process.env.GITHUB_REF;
  if (!ref) return null;

  const match = ref.match(/^refs\/(?:heads|tags)\/(.+)$/);
  if (match) return match[1];

  return ref;
}

/**
 * Build the metadata.json payload using CI environment + CLI flags.
 *
 * @param {string | null} runtime - Runtime string (e.g., "node@20").
 * @param {number | null} durationSeconds - Duration in seconds (if provided).
 * @param {string} auditTimestamp - Timestamp used for bundle directory.
 * @returns {Record<string, unknown>} Metadata object.
 */
function buildMetadata(runtime, durationSeconds, auditTimestamp) {
  const repo = process.env.GITHUB_REPOSITORY || null;
  const commitSha = process.env.GITHUB_SHA || null;
  const branch = deriveBranchName();
  const workflow = process.env.GITHUB_WORKFLOW || null;
  const jobName = process.env.GITHUB_JOB || null;
  const runId = process.env.GITHUB_RUN_ID || null;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT || null;
  const eventName = process.env.GITHUB_EVENT_NAME || null;
  const prNumber = derivePrNumberFromGitHubEvent();

  return {
    repo,
    commit_sha: commitSha,
    branch,
    pr_number: prNumber,
    workflow,
    job_name: jobName,
    runtime: runtime || null,
    duration_seconds: durationSeconds,
    created_at: new Date().toISOString(),
    ci: {
      event_name: eventName,
      run_id: runId,
      run_attempt: runAttempt,
    },
    audit: {
      bundle_type: "unit-tests",
      timestamp: auditTimestamp,
    },
  };
}

/**
 * Main execution:
 *   - Reads CLI args
 *   - Parses JUnit + coverage
 *   - Builds audit directory + writes JSON + copies JUnit XML
 */
function main() {
  const args = parseArgs(process.argv.slice(2));

  const junitPath = args.junit || "out/junit.xml";
  const coveragePath = args.coverage || "out/coverage.json";
  const auditRoot = args["audit-root"] || ".audit";
  const runtime = args.runtime || null;

  let durationSeconds = null;
  if (args["duration-seconds"]) {
    const n = Number.parseFloat(String(args["duration-seconds"]));
    if (Number.isFinite(n)) durationSeconds = n;
  } else if (args["start-ts"] && args["end-ts"]) {
    const start = Number.parseInt(String(args["start-ts"]), 10);
    const end = Number.parseInt(String(args["end-ts"]), 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      durationSeconds = Math.round((end - start) / 1000);
    }
  }

  logInfo(`JUnit path      : ${junitPath}`);
  logInfo(`Coverage path   : ${coveragePath}`);
  logInfo(`Audit root      : ${auditRoot}`);
  logInfo(`Runtime         : ${runtime || "(not provided)"}`);
  logInfo(`Duration (secs) : ${durationSeconds ?? "(unknown)"}`);

  const timestamp = makeSafeTimestamp();
  const auditDir = path.join(auditRoot, timestamp, "unit-tests");

  fs.mkdirSync(auditDir, { recursive: true });
  logInfo(`Writing audit bundle to: ${auditDir}`);

  // 1) JUnit → results.json (+ copy junit.xml)
  let resultsJson;
  if (!fileExists(junitPath)) {
    logWarn(`JUnit file not found at ${junitPath}. Emitting stub results.json.`);
    resultsJson = {
      suites: [],
      total: {
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0,
      },
      meta: {
        reason: "junit-file-missing",
        junit_file: junitPath,
      },
    };
  } else {
    try {
      const junitXml = fs.readFileSync(junitPath, "utf8");
      const parsed = parseJUnit(junitXml);

      resultsJson = {
        suites: parsed.suites,
        total: parsed.total,
      };

      const junitOutPath = path.join(auditDir, "junit.xml");
      fs.copyFileSync(junitPath, junitOutPath);
      logInfo(`Copied JUnit XML to: ${junitOutPath}`);
    } catch (err) {
      logError(
        `Failed to parse JUnit XML at ${junitPath}: ${
          (err && err.message) || err
        }.`
      );
      resultsJson = {
        suites: [],
        total: {
          tests: 0,
          failures: 0,
          errors: 0,
          skipped: 0,
          time: 0,
        },
        meta: {
          reason: "junit-parse-error",
          junit_file: junitPath,
        },
      };
    }
  }

  const resultsOutPath = path.join(auditDir, "results.json");
  fs.writeFileSync(resultsOutPath, JSON.stringify(resultsJson, null, 2), "utf8");
  logInfo(`Wrote results.json to: ${resultsOutPath}`);

  // 2) Coverage → coverage-summary.json
  const coverageSummary = extractCoverageSummary(coveragePath);
  const coverageSummaryOutPath = path.join(auditDir, "coverage-summary.json");
  fs.writeFileSync(
    coverageSummaryOutPath,
    JSON.stringify(coverageSummary, null, 2),
    "utf8"
  );
  logInfo(`Wrote coverage-summary.json to: ${coverageSummaryOutPath}`);

  // 3) Metadata → metadata.json
  const metadata = buildMetadata(runtime, durationSeconds, timestamp);
  const metadataOutPath = path.join(auditDir, "metadata.json");
  fs.writeFileSync(metadataOutPath, JSON.stringify(metadata, null, 2), "utf8");
  logInfo(`Wrote metadata.json to: ${metadataOutPath}`);

  // 4) Human summary
  const total = resultsJson.total || {};
  const tests = total.tests ?? 0;
  const failures = total.failures ?? 0;
  const errors = total.errors ?? 0;
  const skipped = total.skipped ?? 0;
  const time = total.time ?? 0;
  const covLine =
    typeof coverageSummary.summary?.line === "number"
      ? `${coverageSummary.summary.line.toFixed(1)}%`
      : "n/a";

  logInfo(
    `Audit bundle created: ${auditDir} (tests=${tests}, failures=${failures}, errors=${errors}, skipped=${skipped}, time=${time}s, coverage=${covLine})`
  );
}

// Execute
try {
  main();
  process.exit(0);
} catch (err) {
  logError(
    `Unhandled error while exporting unit test audit bundle: ${
      (err && err.message) || err
    }`
  );
  process.exit(1);
}
