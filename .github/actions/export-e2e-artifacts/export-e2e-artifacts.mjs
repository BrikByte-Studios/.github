#!/usr/bin/env node
/**
 * export-e2e-artifacts.mjs
 *
 * Purpose
 * -------
 * Standardize export of E2E artifacts (screenshots, videos, traces) from different runners
 * (Playwright, Cypress, Selenium) into a single audit-ready structure:
 *
 *   .audit/YYYY-MM-DD/e2e/artifacts/
 *     ├─ screenshots/
 *     ├─ videos/
 *     └─ traces/
 *
 * Key behaviors
 * -------------
 * - Works in CI (GitHub Actions) and locally.
 * - Does not crash the job if artifacts are missing (warns + exits 0).
 * - Applies deterministic naming convention:
 *     <browser>_<test-name>_<timestamp>.png
 *     <browser>_<spec-name>_<timestamp>.mp4 (or .webm if source is webm and no conversion is done)
 * - Prints a short summary (counts + locations).
 *
 * Security notes
 * --------------
 * - The script never prints secret env values.
 * - Teams must ensure E2E runs do not render secrets/PII in the UI.
 */

import fs from "fs";
import path from "path";

const cwd = process.cwd();

function envBool(name, defaultValue = "false") {
  const v = (process.env[name] ?? defaultValue).toString().toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envStr(name, def = "") {
  return (process.env[name] ?? def).toString();
}

/**
 * Timestamp in CI-friendly sortable format: YYYYMMDD-HHmmss
 */
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}${MM}${DD}-${hh}${mm}${ss}`;
}

/**
 * Date folder: YYYY-MM-DD
 */
function todayAuditDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Convert arbitrary strings into filesystem-safe slug.
 * Keeps letters/numbers/underscore/dash; converts others to underscore.
 */
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120); // prevent super-long file names
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

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function walkFiles(rootDir) {
  const out = [];
  if (!exists(rootDir)) return out;

  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      if (e.isFile()) out.push(full);
    }
  }
  return out;
}

/**
 * Copy a file to destination (creating dirs) with overwrite.
 */
function copyFileSafe(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/**
 * Attempt to infer a "test/spec name" from an artifact path.
 * This is best-effort: we fall back to filename without extension.
 */
function inferNameFromPath(filePath) {
  const base = path.basename(filePath);
  const noExt = base.replace(/\.[^.]+$/, "");
  return slugify(noExt);
}

/**
 * Main config (env contract)
 *
 * Required across workflows:
 * - E2E_RUNNER   = playwright|cypress|selenium
 * - E2E_BROWSER  = chrome|firefox|webkit|edge|...
 *
 * Optional toggles:
 * - E2E_VIDEO=true|false
 * - E2E_TRACE=true|false
 * - E2E_ARTIFACTS_ALWAYS=true|false
 *
 * Audit roots:
 * - E2E_AUDIT_DATE  default today
 * - E2E_AUDIT_ROOT  default .audit/<date>/e2e/artifacts
 */
const E2E_RUNNER = envStr("E2E_RUNNER", "").toLowerCase();
const E2E_BROWSER = slugify(envStr("E2E_BROWSER", envStr("BROWSER", "unknown")));
const E2E_VIDEO = envBool("E2E_VIDEO", "false");
const E2E_TRACE = envBool("E2E_TRACE", "false");
const E2E_ARTIFACTS_ALWAYS = envBool("E2E_ARTIFACTS_ALWAYS", "false");

// Avoid reading secrets: we only read simple metadata toggles.
const AUDIT_DATE = envStr("E2E_AUDIT_DATE", todayAuditDate());
const AUDIT_ROOT = envStr("E2E_AUDIT_ROOT", path.join(".audit", AUDIT_DATE, "e2e", "artifacts"));

const OUT_SCREENSHOTS = path.join(AUDIT_ROOT, "screenshots");
const OUT_VIDEOS = path.join(AUDIT_ROOT, "videos");
const OUT_TRACES = path.join(AUDIT_ROOT, "traces");

const stamp = nowStamp();

/**
 * Runner-specific sources (best-effort defaults).
 * Repos may override these by setting *_DIR env vars if needed.
 */
const sources = {
  playwright: {
    screenshots: [
      envStr("PLAYWRIGHT_SCREENSHOTS_DIR", "test-results"), // screenshots often under test-results/**/.png
      envStr("PLAYWRIGHT_REPORT_DIR", "playwright-report"), // sometimes screenshots attach here
    ],
    videos: [
      envStr("PLAYWRIGHT_VIDEOS_DIR", "test-results"), // video.webm usually under test-results/**
    ],
    traces: [
      envStr("PLAYWRIGHT_TRACES_DIR", "test-results"), // trace.zip usually under test-results/**
    ],
  },
  cypress: {
    screenshots: [envStr("CYPRESS_SCREENSHOTS_DIR", "cypress/screenshots")],
    videos: [envStr("CYPRESS_VIDEOS_DIR", "cypress/videos")],
    traces: [envStr("CYPRESS_TRACES_DIR", "")], // optional if you store DOM snapshots or extra logs
  },
  selenium: {
    screenshots: [envStr("SELENIUM_SCREENSHOTS_DIR", "e2e-artifacts/screenshots")],
    videos: [envStr("SELENIUM_VIDEOS_DIR", "e2e-artifacts/videos")], // v2 with recorder container
    traces: [envStr("SELENIUM_TRACES_DIR", "e2e-artifacts/traces")], // e.g., HAR/log bundles
  },
};

function warn(msg) {
  console.log(`[E2E-ARTIFACTS] WARN: ${msg}`);
}

function info(msg) {
  console.log(`[E2E-ARTIFACTS] ${msg}`);
}

/**
 * Decide whether we should export at all.
 *
 * - Always export on failure via workflow `if: always()` and `E2E_STATUS=failed`.
 * - On pass:
 *   - export only when E2E_ARTIFACTS_ALWAYS=true
 *   - optionally export videos/traces if E2E_VIDEO/E2E_TRACE toggled (teams may want always-on evidence)
 */
const E2E_STATUS = envStr("E2E_STATUS", "").toLowerCase(); // expected: "success" | "failed"
const isFailed = E2E_STATUS === "failed";

/**
 * Export strategy:
 * - screenshots: always copy if present (esp. on failure)
 * - videos: copy on failure OR if E2E_VIDEO=true OR E2E_ARTIFACTS_ALWAYS=true
 * - traces: copy on failure OR if E2E_TRACE=true OR E2E_ARTIFACTS_ALWAYS=true
 */
const exportScreenshots = isFailed || E2E_ARTIFACTS_ALWAYS;
const exportVideos = isFailed || E2E_VIDEO || E2E_ARTIFACTS_ALWAYS;
const exportTraces = isFailed || E2E_TRACE || E2E_ARTIFACTS_ALWAYS;

if (!E2E_RUNNER) {
  warn("E2E_RUNNER not set. Set E2E_RUNNER=playwright|cypress|selenium for best results.");
}

const runnerKey = (E2E_RUNNER && sources[E2E_RUNNER]) ? E2E_RUNNER : null;

function filterByExt(files, exts) {
  const set = new Set(exts.map((e) => e.toLowerCase()));
  return files.filter((f) => set.has(path.extname(f).toLowerCase()));
}

/**
 * Normalize target names:
 * - For screenshots: png/jpg/jpeg
 * - For videos: mp4/webm (keep original ext unless converting)
 * - For traces: zip/json/har/log
 */
function exportType(kind, sourceDirs, outDir) {
  if (!sourceDirs || sourceDirs.length === 0) return { copied: 0, skipped: true };

  // Collect all files under each dir, ignoring missing dirs.
  const files = [];
  for (const dir of sourceDirs) {
    if (!dir) continue;
    const abs = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
    if (!exists(abs)) continue;
    for (const f of walkFiles(abs)) files.push(f);
  }

  // Runner-specific filters
  let selected = files;
  if (kind === "screenshots") selected = filterByExt(files, [".png", ".jpg", ".jpeg"]);
  if (kind === "videos") selected = filterByExt(files, [".mp4", ".webm"]);
  if (kind === "traces") selected = filterByExt(files, [".zip", ".json", ".har", ".log", ".txt"]);

  if (selected.length === 0) return { copied: 0, skipped: false };

  ensureDir(outDir);

  let copied = 0;
  for (const src of selected) {
    const ext = path.extname(src);
    const inferred = inferNameFromPath(src);

    // Deterministic convention: <browser>_<name>_<timestamp>.<ext>
    const destName = `${E2E_BROWSER}_${inferred}_${stamp}${ext}`;
    const dest = path.join(outDir, destName);

    try {
      copyFileSafe(src, dest);
      copied++;
    } catch (e) {
      warn(`Failed to copy ${src} -> ${dest}: ${(e && e.message) ? e.message : e}`);
    }
  }
  return { copied, skipped: false };
}

function main() {
  info(`Runner=${E2E_RUNNER || "unknown"}, Browser=${E2E_BROWSER}, Status=${E2E_STATUS || "unknown"}`);
  info(`Audit root: ${AUDIT_ROOT}`);

  // Ensure base dirs exist even if empty (helps predictable uploads).
  ensureDir(OUT_SCREENSHOTS);
  ensureDir(OUT_VIDEOS);
  ensureDir(OUT_TRACES);

  if (!runnerKey) {
    warn("Unknown runner. Will attempt generic detection from common folders.");
  }

  const runnerSources = runnerKey ? sources[runnerKey] : {
    screenshots: ["test-results", "playwright-report", "cypress/screenshots", "e2e-artifacts/screenshots"],
    videos: ["test-results", "cypress/videos", "e2e-artifacts/videos"],
    traces: ["test-results", "e2e-artifacts/traces"],
  };

  const results = {
    screenshots: { copied: 0 },
    videos: { copied: 0 },
    traces: { copied: 0 },
  };

  if (exportScreenshots) {
    results.screenshots = exportType("screenshots", runnerSources.screenshots, OUT_SCREENSHOTS);
  } else {
    info("Screenshots export skipped (not failed, and E2E_ARTIFACTS_ALWAYS=false).");
  }

  if (exportVideos) {
    results.videos = exportType("videos", runnerSources.videos, OUT_VIDEOS);
  } else {
    info("Videos export skipped (E2E_VIDEO=false and not failed).");
  }

  if (exportTraces) {
    results.traces = exportType("traces", runnerSources.traces, OUT_TRACES);
  } else {
    info("Traces export skipped (E2E_TRACE=false and not failed).");
  }

  // Summary (counts + paths)
  info("Export summary:");
  info(`  screenshots: ${results.screenshots.copied} -> ${OUT_SCREENSHOTS}`);
  info(`  videos:      ${results.videos.copied} -> ${OUT_VIDEOS}`);
  info(`  traces:      ${results.traces.copied} -> ${OUT_TRACES}`);

  // Never fail the pipeline because artifacts are missing.
  // The E2E runner test step is the source of truth for pass/fail.
  process.exit(0);
}

main();
