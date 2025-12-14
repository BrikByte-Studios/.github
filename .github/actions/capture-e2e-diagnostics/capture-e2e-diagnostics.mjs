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
 * Mitigations
 * -----------
 * Mitigation 1: Retain-on-failure by default (heavy files only on failure)
 *   - E2E_DIAG_HEAVY_ON_FAILURE_ONLY=true|false (default true)
 *
 * Mitigation 2: Size budget enforcement (future enhancement implemented now)
 *   - E2E_DIAG_MAX_TOTAL_MB=150 (default 150)
 *   - Prune order if over budget: network.har -> trace.zip -> dom.html
 *
 * Contingency knobs
 * ----------------
 * - E2E_DIAG_DISABLE_HAR_BY_DEFAULT=true|false (default true)
 *   If true, on non-failure runs we force a small placeholder HAR (even if copied).
 *
 * Behavior
 * --------
 * - Writes stable filenames (console.json, network.har, trace.zip, dom.html, metadata.json).
 * - On missing runner outputs: writes placeholders (keeps downstream stable).
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

function envBool(name, def = true) {
  const v = envStr(name, def ? "true" : "false").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function envNum(name, def) {
  const raw = envStr(name, String(def));
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
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

function isFailure(status) {
  return status === "failed";
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
  let out = String(input ?? "");

  // Common env-like patterns: FOO=bar, token strings, Authorization headers
  const patterns = [
    /Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    /(api[_-]?key|secret|token|password)\s*=\s*[^ \n\r\t"']+/gi,
    /("password"\s*:\s*)"[^"]*"/gi,
    /("token"\s*:\s*)"[^"]*"/gi,
    /("apiKey"\s*:\s*)"[^"]*"/gi,

    // Hard-block markers (extra paranoia)
    /BEGIN PRIVATE KEY/gi,
    /AWS_SECRET_ACCESS_KEY/gi,
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

function removeIfExists(p) {
  try {
    if (exists(p)) fs.unlinkSync(p);
  } catch (e) {
    warn(`prune failed for ${p}: ${e?.message ?? String(e)}`);
  }
}

function fileSizeBytes(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function bytesToMb(bytes) {
  return bytes / (1024 * 1024);
}

function totalDirBytes(dir) {
  try {
    const names = fs.readdirSync(dir);
    return names.reduce((sum, n) => sum + fileSizeBytes(path.join(dir, n)), 0);
  } catch {
    return 0;
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

/**
 * Stable placeholder writers (small, safe, deterministic).
 * These keep downstream tooling stable (RootCauseExplainer, evidence bundlers, etc.).
 */
function writeConsolePlaceholder(outPath, { runner, browser, status, note }) {
  writeFileSafe(
    outPath,
    JSON.stringify(
      {
        runner,
        browser,
        status,
        note: note || "console.json not produced by runner hooks or not supported.",
        entries: [],
      },
      null,
      2
    )
  );
}

function writeHarPlaceholder(outPath, comment) {
  writeFileSafe(
    outPath,
    JSON.stringify(
      {
        log: {
          version: "1.2",
          creator: { name: "brikbyte-diagnostics", version: "1" },
          entries: [],
          comment: comment || "network.har not produced (partial or not supported for this runner).",
        },
      },
      null,
      2
    )
  );
}

function writeTracePlaceholder(outPath, note) {
  // Keep filename contract; content is not a zip.
  writeFileSafe(outPath, note || "trace.zip not produced (not supported or not generated).\n", "utf-8");
}

function writeDomPlaceholder(outPath, note) {
  writeFileSafe(outPath, `<!-- ${note || "dom.html not produced."} -->\n`, "utf-8");
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

  // Policy knobs (Mitigation 1 + Contingency)
  const heavyOnFailureOnly = envBool("E2E_DIAG_HEAVY_ON_FAILURE_ONLY", true);
  const disableHarByDefault = envBool("E2E_DIAG_DISABLE_HAR_BY_DEFAULT", true);

  // Mitigation 2 size budget
  const maxTotalMb = envNum("E2E_DIAG_MAX_TOTAL_MB", 150);

  info(`Runner=${runner}, Browser=${browser}, Status=${status}`);
  info(`Diagnostics root: ${outRoot}`);
  info(`Policy: heavyOnFailureOnly=${heavyOnFailureOnly}, disableHarByDefault=${disableHarByDefault}, maxTotalMb=${maxTotalMb}`);

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

  // ------------------------------------------------------------
  // Mitigation 1: Heavy diagnostics only on failure (default)
  // ------------------------------------------------------------
  const failed = isFailure(status);

  if (heavyOnFailureOnly && !failed) {
    // Even if a runner produced files on success, we shrink them to placeholders.
    // This reduces storage pressure and enforces "retain-on-failure" behaviour centrally.
    if (copied.console) {
      warn("Non-failure run: replacing console.json with placeholder (policy heavyOnFailureOnly).");
      copied.console = false;
    }
    if (copied.dom) {
      warn("Non-failure run: replacing dom.html with placeholder (policy heavyOnFailureOnly).");
      copied.dom = false;
    }
    if (copied.trace) {
      warn("Non-failure run: replacing trace.zip with placeholder (policy heavyOnFailureOnly).");
      copied.trace = false;
    }
    if (copied.network && disableHarByDefault) {
      warn("Non-failure run: replacing network.har with placeholder (policy disableHarByDefault).");
      copied.network = false;
    }
  }

  // ------------------------------------------------------------
  // Placeholders + redaction
  // ------------------------------------------------------------
  if (!copied.console) {
    writeConsolePlaceholder(OUT_CONSOLE, {
      runner,
      browser,
      status,
      note:
        failed
          ? "console.json not produced by runner hooks or not supported."
          : "Policy: heavy diagnostics retained only on failure.",
    });
  } else {
    try {
      const raw = fs.readFileSync(OUT_CONSOLE, "utf-8");
      writeFileSafe(OUT_CONSOLE, redactText(raw));
    } catch {}
  }

  if (!copied.dom) {
    writeDomPlaceholder(
      OUT_DOM,
      failed
        ? "dom.html not produced (runner hook missing or page crashed)."
        : "Policy: heavy diagnostics retained only on failure."
    );
  } else {
    try {
      const raw = fs.readFileSync(OUT_DOM, "utf-8");
      writeFileSafe(OUT_DOM, redactText(raw));
    } catch {}
  }

  if (!copied.trace) {
    writeTracePlaceholder(
      OUT_TRACE,
      failed
        ? "trace.zip not produced (runner does not support or test did not generate trace output).\n"
        : "Policy: heavy diagnostics retained only on failure.\n"
    );
  }

  if (!copied.network) {
    writeHarPlaceholder(
      OUT_NETWORK,
      failed
        ? "network.har not produced (partial or not supported for this runner)."
        : "Policy: HAR disabled by default on non-failure runs."
    );
  } else {
    // Extra policy: even on failure, you may choose to redact HAR later (not implemented here).
    // We keep HAR as-is; rely on safe test data + avoid secrets in headers.
  }

  // ------------------------------------------------------------
  // Mitigation 2: Size budget enforcement (prune heavy files first)
  // ------------------------------------------------------------
  const beforeMb = bytesToMb(totalDirBytes(outRoot));
  const pruned = {
    applied: false,
    beforeMb: Number(beforeMb.toFixed(2)),
    afterMb: null,
    removed: [],
    budgetMb: maxTotalMb,
  };

  if (beforeMb > maxTotalMb) {
    pruned.applied = true;
    warn(`Diagnostics size ${beforeMb.toFixed(2)}MB exceeds budget ${maxTotalMb}MB. Pruning...`);

    // Prune order: HAR -> trace -> DOM (console + metadata are kept)
    removeIfExists(OUT_NETWORK);
    pruned.removed.push("network.har");

    let midMb = bytesToMb(totalDirBytes(outRoot));
    if (midMb > maxTotalMb) {
      removeIfExists(OUT_TRACE);
      pruned.removed.push("trace.zip");
      // Ensure contract still exists (rewrite placeholder)
      writeTracePlaceholder(OUT_TRACE, "trace.zip pruned due to size budget.\n");
    }

    midMb = bytesToMb(totalDirBytes(outRoot));
    if (midMb > maxTotalMb) {
      removeIfExists(OUT_DOM);
      pruned.removed.push("dom.html");
      writeDomPlaceholder(OUT_DOM, "dom.html pruned due to size budget.");
    }

    const afterMb = bytesToMb(totalDirBytes(outRoot));
    pruned.afterMb = Number(afterMb.toFixed(2));
    warn(`Diagnostics size after pruning: ${afterMb.toFixed(2)}MB`);
  }

  // ------------------------------------------------------------
  // Always write metadata.json (safe fields only)
  // ------------------------------------------------------------
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
    copied: {
      // Note: copied values reflect "real copy" intent; policies may overwrite with placeholders.
      // Downstream should treat "copied=false" as "placeholder or not supported / policy-suppressed".
      ...copied,
    },
    policy: {
      heavyOnFailureOnly,
      disableHarByDefault,
      maxTotalMb,
      pruned,
    },
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
        "If a file is not supported by a runner, or suppressed by policy, a placeholder is written to keep contract stable for RootCauseExplainer.",
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
