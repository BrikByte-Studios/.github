#!/usr/bin/env node
/**
 * =============================================================================
 * BrikByteOS — Coverage Merge & Normalization Script
 * -----------------------------------------------------------------------------
 * Task: PIPE-TEST-COVERAGE-INTEG-003
 *
 * Purpose:
 *   Read language-specific coverage outputs (Node, Python, JVM, Go, .NET),
 *   compute overall line coverage, and emit a normalized coverage.json that
 *   governance + audit layers can consume consistently.
 *
 *   This script is intentionally dependency-free (Node stdlib only) and uses
 *   simple JSON/XML/text parsing to avoid extra tooling in CI.
 *
 * Usage (example in CI):
 *
 *   # Node example:
 *   node .github/scripts/coverage-merge.mjs \
 *     --language node \
 *     --out out/coverage.json \
 *     --node-file coverage/coverage-final.json
 *
 *   # Python example (pytest-cov Cobertura XML):
 *   node .github/scripts/coverage-merge.mjs \
 *     --language python \
 *     --out out/coverage.json \
 *     --python-file coverage.xml
 *
 *   # Java example (Jacoco XML):
 *   node .github/scripts/coverage-merge.mjs \
 *     --language java \
 *     --out out/coverage.json \
 *     --jvm-file target/site/jacoco/jacoco.xml
 *
 *   # Go example:
 *   node .github/scripts/coverage-merge.mjs \
 *     --language go \
 *     --out out/coverage.json \
 *     --go-file coverage.out
 *
 *   # .NET example (OpenCover XML from coverlet):
 *   node .github/scripts/coverage-merge.mjs \
 *     --language dotnet \
 *     --out out/coverage.json \
 *     --dotnet-file TestResults/coverage.net.opencover.xml
 *
 * Arguments:
 *   --language=<node|python|java|go|dotnet>
 *   --out=<path/to/coverage.json>
 *
 *   Optional per-language overrides:
 *     --node-file=<path>
 *     --python-file=<path>
 *     --jvm-file=<path>
 *     --go-file=<path>
 *     --dotnet-file=<path>
 *
 * Output (normalized):
 *
 *   {
 *     "language": "node",
 *     "tool": "jest+c8",
 *     "summary": {
 *       "line": 86.3,
 *       "branch": 80.1
 *     },
 *     "generated_at": "2025-11-20T10:00:00.000Z",
 *     "meta": {
 *       "commit": "abc123",
 *       "ref": "refs/heads/main",
 *       "workflow": "CI — Node API Example",
 *       "job": "tests",
 *       "run_id": "123456789"
 *     }
 *   }
 *
 * Behavior:
 *   - If expected coverage file is missing, we:
 *       • Log a warning
 *       • Produce coverage.json with "summary.line = null" and a reason in meta
 *       • Exit 0 (tests themselves should be the source of failure, not merge)
 *
 *   - This script MUST NOT be the thing that fails tests; it is a reporting
 *     layer that governance rules will interpret later.
 * =============================================================================
 */

import fs from "node:fs";
import path from "node:path";

// -----------------------------------------------------------------------------
// Simple CLI arg parser (no external deps)
// -----------------------------------------------------------------------------
/**
 * Parse process.argv into a map of options.
 * Supports:
 *   --key value
 *   --key=value
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
      // Next token is the value (if present)
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

// -----------------------------------------------------------------------------
// Utility helpers
// -----------------------------------------------------------------------------
/**
 * Check if a file exists (safely, without throwing).
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
 * Round a floating value to a fixed number of decimal places.
 */
function round(value, decimals = 1) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Minimal log helpers with a consistent prefix.
 */
function logInfo(message) {
  // eslint-disable-next-line no-console
  console.log(`[COVERAGE-MERGE] ${message}`);
}

function logWarn(message) {
  // eslint-disable-next-line no-console
  console.warn(`[COVERAGE-MERGE] WARNING: ${message}`);
}

function logError(message) {
  // eslint-disable-next-line no-console
  console.error(`[COVERAGE-MERGE] ERROR: ${message}`);
}

// -----------------------------------------------------------------------------
// Arguments & environment
// -----------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));

const language = (args.language || process.env.COV_LANGUAGE || "").toLowerCase();
const outPath = args.out || "out/coverage.json";

if (!language) {
  logError(
    "Missing required --language argument (node|python|java|go|dotnet)."
  );
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Per-language parsers
// -----------------------------------------------------------------------------

/**
 * Parse Node coverage from c8 / istanbul JSON:
 *   Typically: coverage/coverage-final.json
 *
 * Expected shape (simplified):
 *   {
 *     "path/to/file.js": {
 *       "lines": { "covered": 10, "total": 12, "pct": 83.33 },
 *       ...
 *     },
 *     "total": { "lines": { "covered": 100, "total": 120, "pct": 83.33 } }
 *   }
 */
function parseNodeCoverage(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  let covered = 0;
  let total = 0;

  if (data.total && data.total.lines) {
    // Use summarized "total" if present
    covered = data.total.lines.covered ?? 0;
    total = data.total.lines.total ?? 0;
  } else {
    // Aggregate per-file
    for (const value of Object.values(data)) {
      if (!value || typeof value !== "object") continue;
      if (!value.lines) continue;
      covered += value.lines.covered ?? 0;
      total += value.lines.total ?? 0;
    }
  }

  const linePct = total > 0 ? (covered / total) * 100 : null;

  return {
    tool: "jest+c8",
    summary: {
      line: round(linePct),
    },
  };
}

/**
 * Parse Python coverage from Cobertura-like XML (pytest-cov).
 *
 * We keep this intentionally simple by:
 *   - Looking for the root <coverage> element and its line-rate attribute.
 *   - line-rate is typically in [0, 1], so we convert to percentage.
 */
function parsePythonCoverage(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  // Roughly match: <coverage ... line-rate="0.83" ...>
  const match = raw.match(/<coverage[^>]*\sline-rate="([\d.]+)"/i);

  if (!match) {
    logWarn(
      `Unable to locate line-rate attribute in Cobertura XML at ${filePath}`
    );
    return {
      tool: "pytest-cov",
      summary: {
        line: null,
      },
    };
  }

  const rate = parseFloat(match[1]);
  const linePct = Number.isFinite(rate) ? rate * 100 : null;

  return {
    tool: "pytest-cov",
    summary: {
      line: round(linePct),
    },
  };
}

/**
 * Parse JVM coverage from Jacoco XML.
 *
 * We look for the "LINE" counter:
 *   <counter type="LINE" missed="X" covered="Y" />
 */
function parseJvmCoverage(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  const match = raw.match(
    /<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/?>/i
  );

  if (!match) {
    logWarn(
      `Unable to locate Jacoco LINE counter in XML at ${filePath}`
    );
    return {
      tool: "jacoco",
      summary: {
        line: null,
      },
    };
  }

  const missed = parseInt(match[1], 10) || 0;
  const covered = parseInt(match[2], 10) || 0;
  const total = missed + covered;
  const linePct = total > 0 ? (covered / total) * 100 : null;

  return {
    tool: "jacoco",
    summary: {
      line: round(linePct),
    },
  };
}

/**
 * Parse Go coverage profile (go test -coverprofile=coverage.out).
 *
 * Simplified approach:
 *   - Skip first line (mode: set|count|atomic).
 *   - Treat each remaining line as a covered segment.
 *   - Count how many segments have hits > 0 vs total segments.
 *
 * This is an approximation but provides a usable overall %.
 */
function parseGoCoverage(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  if (lines.length <= 1) {
    return {
      tool: "go-cover",
      summary: {
        line: null,
      },
    };
  }

  let totalSegments = 0;
  let coveredSegments = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Each line typically: <path>:<startLine>.<startCol>,<endLine>.<endCol> <numHits> <count>
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    totalSegments += 1;
    const numHits = parseInt(parts[2], 10) || 0;
    if (numHits > 0) {
      coveredSegments += 1;
    }
  }

  const linePct =
    totalSegments > 0 ? (coveredSegments / totalSegments) * 100 : null;

  return {
    tool: "go-cover",
    summary: {
      line: round(linePct),
    },
  };
}

/**
 * Parse .NET coverage from an OpenCover-style XML file (e.g. coverlet).
 *
 * Expected shape (simplified):
 *
 *   <CoverageSession>
 *     <Summary numSequencePoints="123" visitedSequencePoints="110" ... />
 *     ...
 *   </CoverageSession>
 *
 * We compute:
 *   line% = visitedSequencePoints / numSequencePoints * 100
 *
 * Notes:
 *   - For v1 we keep this intentionally simple and only look at <Summary>.
 *   - If the XML does not contain a usable <Summary>, we log a warning and
 *     return a stub with line = null.
 */
function parseDotnetCoverage(filePath) {
  if (!filePath || !fileExists(filePath)) {
    logWarn(
      "No .NET coverage file provided; emitting stub coverage.json. Wire coverlet/opencover later."
    );
    return {
      tool: "dotnet-opencover (stub)",
      summary: {
        line: null,
      },
    };
  }

  const raw = fs.readFileSync(filePath, "utf8");

  // Roughly match: <Summary ... numSequencePoints="123" ... visitedSequencePoints="110" ... />
  const match = raw.match(
    /<Summary[^>]*\snumSequencePoints="(\d+)"[^>]*\svisitedSequencePoints="(\d+)"[^>]*\/?>/i
  );

  if (!match) {
    logWarn(
      `Unable to locate <Summary> with numSequencePoints/visitedSequencePoints in .NET coverage XML at ${filePath}.`
    );
    return {
      tool: "dotnet-opencover (unparsed)",
      summary: {
        line: null,
      },
    };
  }

  const totalSeqPoints = parseInt(match[1], 10) || 0;
  const visitedSeqPoints = parseInt(match[2], 10) || 0;

  const linePct =
    totalSeqPoints > 0 ? (visitedSeqPoints / totalSeqPoints) * 100 : null;

  return {
    tool: "dotnet-opencover",
    summary: {
      line: round(linePct),
    },
  };
}

// -----------------------------------------------------------------------------
// Coverage resolution per language
// -----------------------------------------------------------------------------
/**
 * Build the minimal normalized coverage object including:
 *   - language
 *   - tool
 *   - summary
 *   - generated_at
 *   - meta (GitHub CI context)
 */
function buildCoverageResult(languageKey, tool, summary, metaExtra = {}) {
  return {
    language: languageKey,
    tool,
    summary,
    generated_at: new Date().toISOString(),
    meta: {
      commit: process.env.GITHUB_SHA || null,
      ref: process.env.GITHUB_REF || null,
      workflow: process.env.GITHUB_WORKFLOW || null,
      job: process.env.GITHUB_JOB || null,
      run_id: process.env.GITHUB_RUN_ID || null,
      ...metaExtra,
    },
  };
}

/**
 * Resolve coverage paths per language and invoke the appropriate parser.
 */
function computeCoverage(languageKey) {
  switch (languageKey) {
    case "node": {
      const file =
        args["node-file"] || path.join("coverage", "coverage-final.json");

      if (!fileExists(file)) {
        logWarn(
          `Node coverage file not found at ${file}. Did you enable c8/istanbul coverage?`
        );
        return buildCoverageResult(languageKey, "jest+c8", { line: null }, {
          reason: "node-coverage-file-missing",
          node_file: file,
        });
      }

      const { tool, summary } = parseNodeCoverage(file);
      return buildCoverageResult(languageKey, tool, summary, {
        node_file: file,
      });
    }

    case "python": {
      const file = args["python-file"] || "coverage.xml";

      if (!fileExists(file)) {
        logWarn(
          `Python Cobertura coverage.xml not found at ${file}. Did you run pytest-cov?`
        );
        return buildCoverageResult(languageKey, "pytest-cov", { line: null }, {
          reason: "python-coverage-file-missing",
          python_file: file,
        });
      }

      const { tool, summary } = parsePythonCoverage(file);
      return buildCoverageResult(languageKey, tool, summary, {
        python_file: file,
      });
    }

    case "java": {
      const explicit = args["jvm-file"];
      let file =
        explicit || path.join("target", "site", "jacoco", "jacoco.xml");

      if (!fileExists(file)) {
        // Try an alternate path if the default Jacoco report layout is different
        const alt = path.join("target", "jacoco-report", "jacoco.xml");
        if (fileExists(alt)) {
          file = alt;
        } else {
          logWarn(
            `Jacoco XML coverage not found at ${file} or ${alt}. Did you enable Jacoco?`
          );
          return buildCoverageResult(languageKey, "jacoco", { line: null }, {
            reason: "jvm-coverage-file-missing",
            jvm_file: file,
          });
        }
      }

      const { tool, summary } = parseJvmCoverage(file);
      return buildCoverageResult(languageKey, tool, summary, {
        jvm_file: file,
      });
    }

    case "go": {
      const file = args["go-file"] || "coverage.out";

      if (!fileExists(file)) {
        logWarn(
          `Go coverage profile not found at ${file}. Did you run 'go test -coverprofile=coverage.out'?`
        );
        return buildCoverageResult(languageKey, "go-cover", { line: null }, {
          reason: "go-coverage-file-missing",
          go_file: file,
        });
      }

      const { tool, summary } = parseGoCoverage(file);
      return buildCoverageResult(languageKey, tool, summary, {
        go_file: file,
      });
    }

    case "dotnet": {
      // Default path for coverlet OpenCover output if not overridden:
      //   TestResults/coverage.net.opencover.xml
      const file =
        args["dotnet-file"] ||
        path.join("TestResults", "coverage.net.opencover.xml");

      const { tool, summary } = parseDotnetCoverage(file);

      const meta = {
        dotnet_file: file,
      };

      if (summary.line === null) {
        meta.reason = "dotnet-coverage-unavailable";
      }

      return buildCoverageResult(languageKey, tool, summary, meta);
    }

    default: {
      logWarn(
        `Unsupported language '${languageKey}' for coverage merge. Emitting stub coverage.json.`
      );
      return buildCoverageResult(languageKey, "unknown", { line: null }, {
        reason: "unsupported-language",
      });
    }
  }
}

// -----------------------------------------------------------------------------
// Main execution
// -----------------------------------------------------------------------------
try {
  logInfo(`Language: ${language}`);
  logInfo(`Output : ${outPath}`);

  const result = computeCoverage(language);

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  logInfo(
    `coverage.json written to ${outPath} (line coverage = ${result.summary?.line ?? "n/a"}%)`
  );
  process.exit(0);
} catch (err) {
  logError(`Failed to generate coverage.json: ${(err && err.message) || err}`);
  // Important: this script should be robust, but if it fails completely,
  // we exit non-zero so teams can investigate (tests have already run).
  process.exit(1);
}
