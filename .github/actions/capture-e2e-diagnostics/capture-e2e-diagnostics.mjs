#!/usr/bin/env node
/**
 * capture-e2e-diagnostics.mjs
 *
 * Purpose
 * -------
 * Normalize E2E diagnostics across runners (Playwright/Cypress/Selenium) into:
 *
 *   .audit/YYYY-MM-DD/e2e/diagnostics/
 *     ├─ console.json
 *     ├─ network.har
 *     ├─ trace.zip
 *     ├─ dom.html
 *     └─ metadata.json
 *
 * Contract
 * --------
 * Inputs (env):
 *   - E2E_RUNNER      playwright|cypress|selenium
 *   - E2E_BROWSER     chromium|chrome|firefox|webkit|edge|...
 *   - E2E_STATUS_RAW  success|failure|cancelled OR success|failed
 *
 * Optional audit overrides:
 *   - E2E_AUDIT_DATE  YYYY-MM-DD
 *   - E2E_DIAG_ROOT   custom output root (default .audit/<date>/e2e/diagnostics)
 *
 * Source discovery (env overrides):
 *   Playwright:
 *     - PLAYWRIGHT_DIAG_DIR (default "test-results/diagnostics")
 *   Cypress:
 *     - CYPRESS_DIAG_DIR    (default "cypress/diagnostics")
 *   Selenium:
 *     - SELENIUM_DIAG_DIR   (default "target/selenium-artifacts/diagnostics")
 *
 * Behavior
 * --------
 * - Writes stable filenames (console.json, network.har, trace.zip, dom.html, metadata.json).
 * - On non-failure runs: still writes metadata + placeholders (keeps downstream stable).
 * - Never fails the job if sources are missing; prints WARN and exits 0.
 *
 * Security
 * --------
 * - Best-effort redaction for common secret patterns in console.json + dom.html.
 * - Do NOT render real secrets in test environments.
 */

import fs from "fs";
import path from "path";

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const cwd = workspace;

function envStr(name, def = "") {
  const v = process.env[name];
  if (v === undefined) return def;
  const s = String(v).trim();
  return s === "" ? def : s;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function todayAuditDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeStatus(raw) {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "failed" || v === "failure" || v === "cancelled" || v === "canceled") return "failed";
  if (v === "success") return "success";
  return v || "unknown";
}

function info(msg) {
  console.log(`[E2E-DIAGNOSTICS] ${msg}`);
}

function warn(msg) {
  console.log(`[E2E-DIAGNOSTICS] WARN: ${msg}`);
}

/**
 * Very small, best-effort redactor.
 * You can expand this later with stricter patterns (tokens, JWTs, etc.).
 */
function redactText(input) {
  let out = input;

  // Common env-like patterns: FOO=bar, token strings, Authorization headers
  const patterns = [
    /Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    /(api[_-]?key|secret|token|password)\s*=\s*[^ \n\r\t"']+/gi,
    /("password"\s*:\s*)"[^"]*"/gi,
    /("token"\s*:\s*)"[^"]*"/gi,
    /("apiKey"\s*:\s*)"[^"]*"/gi,
  ];

  for (const p of patterns) {
    out = out.replace(p, (m, g1) => {
      if (g1) return `${g1}"[REDACTED]"`;
      return "[REDACTED]";
    });
  }

  return out;
}

function writeFileSafe(filePath, content, encoding = "utf-8") {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, encoding);
}

function copyIfExists(src, dest) {
  try {
    if (!src) return false;
    const abs = path.isAbsolute(src) ? src : path.join(cwd, src);
    if (!exists(abs)) return false;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(abs, dest);
    return true;
  } catch (e) {
    warn(`copy failed: ${src} -> ${dest}: ${e?.message ?? String(e)}`);
    return false;
  }
}

/**
 * Find a file in a directory (non-recursive) by candidate names.
 */
function findInDir(dir, candidates) {
  const abs = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
  if (!exists(abs)) return "";
  for (const c of candidates) {
    const p = path.join(abs, c);
    if (exists(p)) return p;
  }
  return "";
}

function main() {
  const runner = envStr("E2E_RUNNER", "unknown").toLowerCase();
  const browser = envStr("E2E_BROWSER", "unknown");
  const status = normalizeStatus(envStr("E2E_STATUS_RAW", "unknown"));

  const auditDate = envStr("E2E_AUDIT_DATE", todayAuditDate());
  const defaultRoot = path.join(".audit", auditDate, "e2e", "diagnostics");
  const outRoot = envStr("E2E_DIAG_ROOT", defaultRoot);

  const OUT_CONSOLE = path.join(outRoot, "console.json");
  const OUT_NETWORK = path.join(outRoot, "network.har");
  const OUT_TRACE = path.join(outRoot, "trace.zip");
  const OUT_DOM = path.join(outRoot, "dom.html");
  const OUT_META = path.join(outRoot, "metadata.json");

  info(`Runner=${runner}, Browser=${browser}, Status=${status}`);
  info(`Diagnostics root: ${outRoot}`);

  ensureDir(outRoot);

  // Runner-specific source roots
  const diagRoots = {
    playwright: envStr("PLAYWRIGHT_DIAG_DIR", "test-results/diagnostics"),
    cypress: envStr("CYPRESS_DIAG_DIR", "cypress/diagnostics"),
    selenium: envStr("SELENIUM_DIAG_DIR", "target/selenium-artifacts/diagnostics"),
  };

  const root = diagRoots[runner] || "";

  // Stable naming contract: these are what runner hooks should produce
  const srcConsole = root ? findInDir(root, ["console.json"]) : "";
  const srcNetwork = root ? findInDir(root, ["network.har"]) : "";
  const srcTrace = root ? findInDir(root, ["trace.zip"]) : "";
  const srcDom = root ? findInDir(root, ["dom.html"]) : "";

  // Copy what we have
  const copied = {
    console: copyIfExists(srcConsole, OUT_CONSOLE),
    network: copyIfExists(srcNetwork, OUT_NETWORK),
    trace: copyIfExists(srcTrace, OUT_TRACE),
    dom: copyIfExists(srcDom, OUT_DOM),
  };

  // If missing, create placeholders to keep downstream stable
  if (!copied.console) {
    writeFileSafe(
      OUT_CONSOLE,
      JSON.stringify(
        {
          runner,
          browser,
          status,
          note: "console.json not produced by runner hooks or not supported.",
          entries: [],
        },
        null,
        2
      )
    );
  } else {
    // redact in-place (best-effort)
    try {
      const raw = fs.readFileSync(OUT_CONSOLE, "utf-8");
      writeFileSafe(OUT_CONSOLE, redactText(raw));
    } catch {}
  }

  if (!copied.network) {
    // HAR placeholder (still valid JSON)
    writeFileSafe(
      OUT_NETWORK,
      JSON.stringify(
        {
          log: {
            version: "1.2",
            creator: { name: "brikbyte-diagnostics", version: "1" },
            entries: [],
            comment: "network.har not produced (partial or not supported for this runner).",
          },
        },
        null,
        2
      )
    );
  }

  if (!copied.trace) {
    // Placeholder: trace.zip absent; create a small text marker alongside metadata
    // (We keep the filename contract by writing a readable file, not a real zip.)
    writeFileSafe(
      OUT_TRACE,
      "trace.zip not produced (runner does not support or test did not generate trace output).\n",
      "utf-8"
    );
  }

  if (!copied.dom) {
    writeFileSafe(
      OUT_DOM,
      `<!-- dom.html not produced (runner hook missing or page crashed). -->\n`,
      "utf-8"
    );
  } else {
    // redact in-place (best-effort)
    try {
      const raw = fs.readFileSync(OUT_DOM, "utf-8");
      writeFileSafe(OUT_DOM, redactText(raw));
    } catch {}
  }

  // Always write metadata.json (safe fields only)
  const metadata = {
    runner,
    browser,
    status,
    output: {
      root: outRoot,
      files: {
        console: "console.json",
        network: "network.har",
        trace: "trace.zip",
        dom: "dom.html",
      },
    },
    copied,
    ci: {
      repo: envStr("REPO", ""),
      sha: envStr("GIT_SHA", ""),
      ref: envStr("REF", ""),
      workflow: envStr("WORKFLOW", ""),
      job: envStr("JOB", ""),
      runId: envStr("RUN_ID", ""),
      runAttempt: envStr("RUN_ATTEMPT", ""),
    },
    timestamp: new Date().toISOString(),
    notes: {
      placeholders:
        "If a file is not supported by a runner, a placeholder is written to keep contract stable for RootCauseExplainer.",
    },
  };

  writeFileSafe(OUT_META, JSON.stringify(metadata, null, 2));

  info(`Wrote: ${OUT_CONSOLE}`);
  info(`Wrote: ${OUT_NETWORK}`);
  info(`Wrote: ${OUT_TRACE}`);
  info(`Wrote: ${OUT_DOM}`);
  info(`Wrote: ${OUT_META}`);

  process.exit(0);
}

main();
