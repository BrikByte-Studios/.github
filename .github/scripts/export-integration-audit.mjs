#!/usr/bin/env node
/**
 * BrikPipe — Integration Audit Exporter
 * -------------------------------------
 *
 * Purpose:
 *   Collect integration test evidence into a stable, governance-ready
 *   .audit/YYYY-MM-DD/integration/ bundle, including:
 *     - JUnit XML (if present)
 *     - Normalized JSON results (if present or stubbed)
 *     - Container logs (app, db, mocks, runner)
 *     - Optional coverage summary
 *     - metadata.json (GitHub + runtime context)
 *
 * Guarantees:
 *   - Never intentionally writes raw secrets or credentials.
 *   - Runs safely even if some inputs are missing (logs path, JUnit, etc).
 *
 * Expected environment variables (from GitHub Actions):
 *   SERVICE_WORKDIR           : Service root within repo (e.g. "node-api-example")
 *   GITHUB_REPOSITORY         : "owner/repo"
 *   GITHUB_ACTOR              : Actor that triggered the run
 *   GITHUB_SHA                : Commit SHA
 *   GITHUB_REF_NAME           : Branch / tag name
 *   GITHUB_RUN_ID             : Numeric run id
 *   GITHUB_RUN_NUMBER         : Sequential run number
 *   GITHUB_RUN_ATTEMPT        : Attempt count for this run
 *   GITHUB_JOB                : Job name
 *   GITHUB_WORKFLOW           : Workflow name
 *   GITHUB_SERVER_URL         : https://github.com
 *   SERVICE_IMAGE             : Container image used for the app under test
 *   TEST_LANGUAGE             : Runtime (node | python | java | go | dotnet)
 *   INTEG_JOB_STARTED_AT      : ISO UTC time when integration job started
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Minimal flag parser.
 * Converts:
 *   ["--junit", "x", "--results", "y"]
 * into:
 *   { junit: "x", results: "y" }
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  const parts = argv.slice(2);
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    if (token.startsWith("--")) {
      const key = token.replace(/^--/, "");
      const next = parts[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

/**
 * Simple logger with prefix so it’s easy to grep in CI logs.
 */
function log(message) {
  // eslint-disable-next-line no-console
  console.log(`[INTEG-AUDIT] ${message}`);
}

/**
 * Mask secrets by replacing known secret values with "***MASKED***".
 * This uses process.env so actual secret values are never logged,
 * but any occurrence of them in logs / JSON will be redacted.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeText(text) {
  let result = text;

  // Collect env values that look like secrets.
  const secretEnvKeys = Object.keys(process.env).filter((key) => {
    return (
      key.startsWith("INTEG_") ||
      key.startsWith("JWT_") ||
      key.includes("SECRET") ||
      key.includes("PASSWORD") ||
      key.includes("TOKEN")
    );
  });

  for (const key of secretEnvKeys) {
    const value = process.env[key];
    if (!value) continue;
    // Replace raw value wherever it appears.
    result = result.split(value).join("***MASKED***");
  }

  return result;
}

/**
 * Copy a file into the audit directory if the source exists.
 *
 * @param {string} srcPath
 * @param {string} destPath
 */
async function copyIfExists(srcPath, destPath) {
  try {
    await fs.access(srcPath);
  } catch {
    log(`Skipping missing file: ${srcPath}`);
    return;
  }

  const raw = await fs.readFile(srcPath, "utf8");
  const sanitized = sanitizeText(raw);
  await fs.writeFile(destPath, sanitized, "utf8");
  log(`Copied (sanitized) file into audit bundle: ${destPath}`);
}

/**
 * Recursively traverse a directory and apply a callback to each file.
 *
 * @param {string} dir
 * @param {(filePath: string) => Promise<void>} cb
 */
async function walkDir(dir, cb) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, cb);
    } else if (entry.isFile()) {
      await cb(full);
    }
  }
}

/**
 * Copy logs from logsDir into auditDir/logs with sanitization.
 *
 * @param {string} logsDir
 * @param {string} auditLogsDir
 */
async function copyLogsDirectory(logsDir, auditLogsDir) {
  try {
    await fs.access(logsDir);
  } catch {
    log(`No logs directory found at ${logsDir}; skipping logs.`);
    return;
  }

  await fs.mkdir(auditLogsDir, { recursive: true });

  await walkDir(logsDir, async (filePath) => {
    const rel = path.relative(logsDir, filePath);
    const dest = path.join(auditLogsDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });

    const raw = await fs.readFile(filePath, "utf8");
    const sanitized = sanitizeText(raw);
    await fs.writeFile(dest, sanitized, "utf8");
    log(`Copied (sanitized) log: ${rel}`);
  });
}

/**
 * Generate metadata.json for this audit bundle.
 *
 * @param {string} runtime
 * @param {string} serviceImage
 */
function buildMetadata(runtime, serviceImage) {
  const env = process.env;

  const startTime =
    env.INTEG_JOB_STARTED_AT ||
    env.GITHUB_RUN_STARTED_AT || // custom if you add it
    null;
  const endTime = new Date().toISOString();

  let durationSeconds = null;
  if (startTime) {
    try {
      const start = Date.parse(startTime);
      const end = Date.parse(endTime);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        durationSeconds = Math.round((end - start) / 1000);
      }
    } catch {
      // ignore parse error; leave durationSeconds as null
    }
  }

  return {
    repo: env.GITHUB_REPOSITORY || null,
    actor: env.GITHUB_ACTOR || null,
    commit_sha: env.GITHUB_SHA || null,
    branch: env.GITHUB_REF_NAME || null,
    pr_number: env.GITHUB_REF?.includes("/pull/") ? env.GITHUB_REF : null,
    runtime: runtime || null,
    service_image: serviceImage || null,

    start_time: startTime,
    end_time: endTime,
    duration_seconds: durationSeconds,

    github: {
      run_id: env.GITHUB_RUN_ID || null,
      run_number: env.GITHUB_RUN_NUMBER || null,
      run_attempt: env.GITHUB_RUN_ATTEMPT || null,
      job: env.GITHUB_JOB || null,
      workflow: env.GITHUB_WORKFLOW || null,
      server_url: env.GITHUB_SERVER_URL || "https://github.com",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const serviceWorkdir = process.env.SERVICE_WORKDIR || ".";
  const runtime = process.env.TEST_LANGUAGE || "unknown";
  const serviceImage = process.env.SERVICE_IMAGE || "unknown";

  // Defaults based on SERVICE_WORKDIR layout used in examples:
  //   node-api-example/out/junit-integration.xml
  //   python-api-example/out/junit-integration.xml
  //   etc.
  const junitPath =
    args.junit ||
    path.join(serviceWorkdir, "out", "junit-integration.xml");

  const resultsPath =
    args.results ||
    path.join(serviceWorkdir, "out", "integration-results.json");

  const logsDir =
    args["logs-dir"] ||
    path.join(serviceWorkdir, "out", "integration-logs");

  const coveragePath =
    args.coverage ||
    path.join(serviceWorkdir, "out", "coverage-integration.json");

  const outRoot = args["out-root"] || ".audit";

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const auditBaseDir = path.join(outRoot, dateStr, "integration");

  log(`Service workdir   : ${serviceWorkdir}`);
  log(`JUnit XML source  : ${junitPath}`);
  log(`Results JSON src  : ${resultsPath}`);
  log(`Logs directory    : ${logsDir}`);
  log(`Coverage source   : ${coveragePath}`);
  log(`Audit base dir    : ${auditBaseDir}`);

  await fs.mkdir(auditBaseDir, { recursive: true });

  // 1) Copy junit.xml (if present)
  await copyIfExists(junitPath, path.join(auditBaseDir, "junit.xml"));

  // 2) Copy or stub results.json
  try {
    await fs.access(resultsPath);
    await copyIfExists(
      resultsPath,
      path.join(auditBaseDir, "results.json"),
    );
  } catch {
    const stub = {
      note:
        "No normalized integration results JSON provided. See junit.xml for raw test results.",
      created_at: now.toISOString(),
    };
    const sanitized = sanitizeText(JSON.stringify(stub, null, 2));
    await fs.writeFile(
      path.join(auditBaseDir, "results.json"),
      sanitized,
      "utf8",
    );
    log("Created stub results.json (no source results file found).");
  }

  // 3) Copy logs directory (sanitized)
  await copyLogsDirectory(logsDir, path.join(auditBaseDir, "logs"));

  // 4) Copy coverage summary if present
  await copyIfExists(
    coveragePath,
    path.join(auditBaseDir, "coverage-summary.json"),
  );

  // 5) metadata.json
  const metadata = buildMetadata(runtime, serviceImage);
  const metadataSanitized = sanitizeText(JSON.stringify(metadata, null, 2));
  await fs.writeFile(
    path.join(auditBaseDir, "metadata.json"),
    metadataSanitized,
    "utf8",
  );
  log("Written metadata.json");

  // Final listing for debugging
  const tree = await fs.readdir(auditBaseDir, { withFileTypes: true });
  log("Audit directory contents (top-level):");
  for (const entry of tree) {
    log(` - ${entry.name}${entry.isDirectory() ? "/" : ""}`);
  }

  log("Integration audit export completed ✅");
}

main().catch((err) => {
  console.error("[INTEG-AUDIT] ERROR:", err);
  process.exit(1);
});
