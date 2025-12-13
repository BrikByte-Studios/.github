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
 * Size guardrails (Mitigation 2)
 * ------------------------------
 * - Enforces a max total budget for exported artifacts:
 *     E2E_MAX_TOTAL_MB (default 300)
 * - Enforces retention for videos (keep newest N):
 *     E2E_MAX_VIDEOS (default 10)
 * - If over budget, deletes oldest first in this order:
 *     videos -> traces -> screenshots
 *
 * Security notes
 * --------------
 * - The script never prints secret env values.
 * - Teams must ensure E2E runs do not render secrets/PII in the UI.
 */

import fs from "fs";
import path from "path";

/**
 * Always resolve paths relative to the GitHub workspace when running in Actions.
 * This prevents writing .audit into the action folder instead of the repo root.
 */
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const cwd = workspace;


function envBool(name, defaultValue = "false") {
  const v = (process.env[name] ?? defaultValue).toString().toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envStr(name, def = "") {
  const v = process.env[name];
  if (v === undefined) return def;
  const s = v.toString();
  return s.trim() === "" ? def : s;
}


function envInt(name, def) {
  const raw = envStr(name, String(def)).trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
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

function warn(msg) {
  console.log(`[E2E-ARTIFACTS] WARN: ${msg}`);
}

function info(msg) {
  console.log(`[E2E-ARTIFACTS] ${msg}`);
}

function filterByExt(files, exts) {
  const set = new Set(exts.map((e) => e.toLowerCase()));
  return files.filter((f) => set.has(path.extname(f).toLowerCase()));
}

function fileSizeBytes(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function fileMtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function sumBytes(files) {
  return files.reduce((acc, f) => acc + fileSizeBytes(f), 0);
}

/**
 * Keep only newest N video files inside:
 *   <AUDIT_ROOT>/videos
 *
 * Deletes older videos by mtime ascending (oldest first).
 * Best-effort; never throws.
 */
function enforceMaxVideos(auditRoot, maxVideos) {
  const dir = path.join(auditRoot, "videos");
  if (!exists(dir)) return { kept: 0, deleted: 0 };

  const files = walkFiles(dir).sort((a, b) => fileMtimeMs(b) - fileMtimeMs(a));
  if (files.length <= maxVideos) return { kept: files.length, deleted: 0 };

  const toDelete = files.slice(maxVideos);
  let deleted = 0;

  for (const f of toDelete) {
    try {
      fs.unlinkSync(f);
      deleted += 1;
    } catch (e) {
      warn(`MaxVideos: failed to delete ${path.basename(f)}: ${e?.message ?? String(e)}`);
    }
  }

  return { kept: files.length - deleted, deleted };
}

/**
 * Enforce total artifact budget under:
 *   <AUDIT_ROOT>/{screenshots,videos,traces}
 *
 * Removal order (oldest first):
 *   1) videos
 *   2) traces
 *   3) screenshots
 *
 * Best-effort; never throws; returns final size.
 */
function enforceTotalBudget(auditRoot, maxBytes) {
  const videosDir = path.join(auditRoot, "videos");
  const tracesDir = path.join(auditRoot, "traces");
  const shotsDir = path.join(auditRoot, "screenshots");

  const collect = () => ({
    videos: walkFiles(videosDir),
    traces: walkFiles(tracesDir),
    screenshots: walkFiles(shotsDir),
  });

  const sortOldestFirst = (files) =>
    files
      .slice()
      .sort((a, b) => fileMtimeMs(a) - fileMtimeMs(b));

  const allFiles = () => {
    const c = collect();
    return [...c.videos, ...c.traces, ...c.screenshots];
  };

  let total = sumBytes(allFiles());
  if (total <= maxBytes) return { trimmed: 0, totalBytes: total };

  let trimmed = 0;

  const tryDelete = (f) => {
    const s = fileSizeBytes(f);
    try {
      fs.unlinkSync(f);
      total = Math.max(0, total - s);
      trimmed += 1;
      return true;
    } catch (e) {
      warn(`Budget: failed to delete ${path.basename(f)}: ${e?.message ?? String(e)}`);
      return false;
    }
  };

  const c0 = collect();
  const queues = [
    sortOldestFirst(c0.videos),
    sortOldestFirst(c0.traces),
    sortOldestFirst(c0.screenshots),
  ];

  while (total > maxBytes) {
    let removedAny = false;

    for (const q of queues) {
      while (q.length && total > maxBytes) {
        const f = q.shift();
        if (tryDelete(f)) removedAny = true;
      }
      if (total <= maxBytes) break;
    }

    if (!removedAny) break;
  }

  return { trimmed, totalBytes: total };
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
 * Guardrails:
 * - E2E_MAX_TOTAL_MB (default 300)
 * - E2E_MAX_VIDEOS   (default 10)
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

// Guardrails (safe metadata; not secrets)
const E2E_MAX_TOTAL_MB = envInt("E2E_MAX_TOTAL_MB", 300);
const E2E_MAX_VIDEOS = envInt("E2E_MAX_VIDEOS", 10);
const E2E_MAX_TOTAL_BYTES = Math.max(0, E2E_MAX_TOTAL_MB) * 1024 * 1024;

// Avoid reading secrets: we only read simple metadata toggles.
const AUDIT_DATE = envStr("E2E_AUDIT_DATE", todayAuditDate());
const AUDIT_ROOT = envStr(
  "E2E_AUDIT_ROOT",
  path.join(".audit", AUDIT_DATE, "e2e", "artifacts"),
);

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
      envStr("PLAYWRIGHT_SCREENSHOTS_DIR", "test-results"),
      envStr("PLAYWRIGHT_REPORT_DIR", "playwright-report"),
    ],
    videos: [envStr("PLAYWRIGHT_VIDEOS_DIR", "test-results")],
    traces: [envStr("PLAYWRIGHT_TRACES_DIR", "test-results")],
  },
  cypress: {
    screenshots: [envStr("CYPRESS_SCREENSHOTS_DIR", "cypress/screenshots")],
    videos: [envStr("CYPRESS_VIDEOS_DIR", "cypress/videos")],
    traces: [envStr("CYPRESS_TRACES_DIR", "")],
  },
  selenium: {
    screenshots: [envStr("SELENIUM_SCREENSHOTS_DIR", "e2e-artifacts/screenshots")],
    videos: [envStr("SELENIUM_VIDEOS_DIR", "e2e-artifacts/videos")],
    traces: [envStr("SELENIUM_TRACES_DIR", "e2e-artifacts/traces")],
  },
};

/**
 * Normalize status across GitHub + BrikByte contract.
 *
 * GitHub job.status: success | failure | cancelled
 * BrikByte contract: success | failed
 */
function normalizeStatus(raw) {
  const v = (raw ?? "").toString().toLowerCase().trim();
  if (v === "failed" || v === "failure" || v === "cancelled" || v === "canceled") return "failed";
  if (v === "success") return "success";
  return v; // unknown stays unknown
}

const E2E_STATUS_RAW = envStr("E2E_STATUS", "");
const E2E_STATUS = normalizeStatus(E2E_STATUS_RAW);
const isFailed = E2E_STATUS === "failed";

const exportScreenshots = isFailed || E2E_ARTIFACTS_ALWAYS;
const exportVideos = isFailed || E2E_VIDEO || E2E_ARTIFACTS_ALWAYS;
const exportTraces = isFailed || E2E_TRACE || E2E_ARTIFACTS_ALWAYS;

if (!E2E_RUNNER) {
  warn("E2E_RUNNER not set. Use E2E_RUNNER=playwright|cypress|selenium for best results.");
}

const runnerKey = (E2E_RUNNER && sources[E2E_RUNNER]) ? E2E_RUNNER : null;

/**
 * Export files by kind into audit folder with normalized naming.
 */
function exportType(kind, sourceDirs, outDir) {
  if (!sourceDirs || sourceDirs.length === 0) return { copied: 0, skipped: true };

  const files = [];
  for (const dir of sourceDirs) {
    if (!dir) continue;
    const abs = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
    if (!exists(abs)) continue;
    for (const f of walkFiles(abs)) files.push(f);
  }

  let selected = files;
  if (kind === "screenshots") selected = filterByExt(files, [".png", ".jpg", ".jpeg"]);
  if (kind === "videos") selected = filterByExt(files, [".mp4", ".webm"]);
  if (kind === "traces") selected = filterByExt(files, [
    ".zip", ".json", ".har", ".log", ".txt",
    ".html", ".css", ".js", ".map"
  ]);

  if (selected.length === 0) return { copied: 0, skipped: false };

  ensureDir(outDir);

  let copied = 0;
  for (const src of selected) {
    const ext = path.extname(src);
    const inferred = inferNameFromPath(src);
    const destName = `${E2E_BROWSER}_${inferred}_${stamp}${ext}`;
    const dest = path.join(outDir, destName);

    try {
      copyFileSafe(src, dest);
      copied++;
    } catch (e) {
      warn(`Copy failed: ${path.basename(src)} -> ${path.basename(dest)}: ${e?.message ?? String(e)}`);
    }
  }

  return { copied, skipped: false };
}

/**
 * Always write a manifest so CI uploads never warn about "no files found".
 *
 * Security:
 * - Only includes non-secret metadata (runner/browser/status/toggles/counts/paths).
 * - Never prints or stores secret env values.
 */
function writeManifest(auditRoot, payload) {
  try {
    const p = path.join(auditRoot, "_export-manifest.json");
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf-8");
  } catch (e) {
    warn(`Failed to write manifest: ${(e && e.message) ? e.message : e}`);
  }
}


function main() {
  info(`Runner=${E2E_RUNNER || "unknown"}, Browser=${E2E_BROWSER}, Status=${E2E_STATUS || "unknown"}`);
  info(`Audit root: ${AUDIT_ROOT}`);
  info(`Guardrails: max_total_mb=${E2E_MAX_TOTAL_MB}, max_videos=${E2E_MAX_VIDEOS}`);

  ensureDir(OUT_SCREENSHOTS);
  ensureDir(OUT_VIDEOS);
  ensureDir(OUT_TRACES);

  if (!runnerKey) {
    warn("Unknown runner. Using generic detection from common folders.");
  }

  const runnerSources = runnerKey
    ? sources[runnerKey]
    : {
        screenshots: ["test-results", "playwright-report", "cypress/screenshots", "e2e-artifacts/screenshots"],
        videos: ["test-results", "cypress/videos", "e2e-artifacts/videos"],
        traces: ["test-results", "e2e-artifacts/traces"],
      };

  const results = {
    screenshots: { copied: 0 },
    videos: { copied: 0 },
    traces: { copied: 0 },
  };

  try {
    if (exportScreenshots) {
      results.screenshots = exportType("screenshots", runnerSources.screenshots, OUT_SCREENSHOTS);
    } else {
      info("Screenshots export skipped (not failed and E2E_ARTIFACTS_ALWAYS=false).");
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
  } catch (e) {
    warn(`Unexpected export error: ${e?.message ?? String(e)}`);
  }

  // --------------------------------------------------------------------------
  // Guardrails: retention + total budget (best-effort, never fatal)
  // --------------------------------------------------------------------------
  try {
    const v = enforceMaxVideos(AUDIT_ROOT, E2E_MAX_VIDEOS);
    if (v.deleted > 0) info(`Retention: deleted_videos=${v.deleted}, kept=${v.kept}`);
  } catch (e) {
    warn(`Retention step failed: ${e?.message ?? String(e)}`);
  }

  try {
    const b = enforceTotalBudget(AUDIT_ROOT, E2E_MAX_TOTAL_BYTES);
    if (b.trimmed > 0) {
      const mb = Math.round(b.totalBytes / 1024 / 1024);
      info(`Budget: trimmed_files=${b.trimmed}, final_size_mb=${mb}`);
    }
  } catch (e) {
    warn(`Budget step failed: ${e?.message ?? String(e)}`);
  }

  info("Export summary:");
  info(`  screenshots: ${results.screenshots.copied} -> ${OUT_SCREENSHOTS}`);
  info(`  videos:      ${results.videos.copied} -> ${OUT_VIDEOS}`);
  info(`  traces:      ${results.traces.copied} -> ${OUT_TRACES}`);

  // Always persist a manifest file so the audit upload path has at least one file.
  writeManifest(AUDIT_ROOT, {
    runner: E2E_RUNNER || "unknown",
    browser: E2E_BROWSER,
    status: E2E_STATUS || "unknown",
    toggles: {
      video: E2E_VIDEO,
      trace: E2E_TRACE,
      artifactsAlways: E2E_ARTIFACTS_ALWAYS,
    },
    exportDecision: {
      screenshots: exportScreenshots,
      videos: exportVideos,
      traces: exportTraces,
    },
    copied: {
      screenshots: results.screenshots.copied ?? 0,
      videos: results.videos.copied ?? 0,
      traces: results.traces.copied ?? 0,
    },
    outputDirs: {
      auditRoot: AUDIT_ROOT,
      screenshots: OUT_SCREENSHOTS,
      videos: OUT_VIDEOS,
      traces: OUT_TRACES,
    },
    stamp,
  });


  process.exit(0);
}

main();
