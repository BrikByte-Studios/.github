#!/usr/bin/env node
/**
 * BrikByteOS — Flaky Analytics Exporter (Node ESM)
 * ------------------------------------------------
 * Purpose:
 *   - Read current run flaky evaluation evidence (evaluation.json) + rerun summary (summary*.json)
 *   - Aggregate historical per-run summaries under `.audit/**flaky/flaky-summary.json`
 *   - Emit auditable JSON artifacts under `.audit/YYYY-MM-DD/flaky/`
 *   - Optionally emit a human-readable Markdown summary under `out/flaky/flaky-summary.md`
 *
 * Inputs (current run):
 *   - evaluation.json            (required unless --allow-missing-evaluation true)
 *   - summary.json OR summary.normalized.json OR labeled summary (optional)
 *
 * Outputs:
 *   - .audit/YYYY-MM-DD/flaky/flaky-summary.json   (per-run)
 *   - .audit/YYYY-MM-DD/flaky/flaky-trends.json    (7/30 day trends)
 *   - .audit/YYYY-MM-DD/flaky/metadata.json        (run metadata)
 *   - out/flaky/flaky-summary.md                   (optional)
 *
 * CLI:
 *   node export-flaky-analytics.mjs \
 *     --suite unit \
 *     --audit-root .audit \
 *     --out-dir out/flaky \
 *     --input out/flaky/summary.normalized.json \
 *     --evaluation out/flaky/evaluation.json \
 *     --top-n 10 \
 *     --write-md true \
 *     --require-enabled true \
 *     --allow-missing-evaluation true \
 *     --pr 42
 *
 * Notes:
 * - This exporter is intentionally deterministic: stable sorting, stable output.
 * - Suite-level reruns will emit test_name="(suite-level)" (NOT "unknown-test").
 */

import fs from "node:fs";
import path from "node:path";

/** @typedef {"pass"|"informational"|"flaky"|"quarantine-candidate"|"consistently-failing"|"unknown"} Classification */

/**
 * @typedef {Object} RunMetadata
 * @property {string} repo
 * @property {string} run_id
 * @property {string=} workflow
 * @property {string=} actor
 * @property {string=} attempt
 * @property {string=} commit
 * @property {string=} branch
 * @property {number|null=} pr
 * @property {string=} runtime
 * @property {string} generated_at ISO timestamp
 */

/**
 * @typedef {Object} FlakySummaryRow
 * @property {string} run_id
 * @property {string} repo
 * @property {string} suite
 * @property {string} test_name
 * @property {number} pass_count
 * @property {number} fail_count
 * @property {number} total
 * @property {number} fail_rate 0..1
 * @property {Classification} classification
 * @property {string} first_seen ISO
 * @property {string} last_seen ISO
 * @property {string} generated_at ISO (this run)
 */

/**
 * @typedef {Object} TrendsTestRow
 * @property {string} test_name
 * @property {string} suite
 * @property {number} runs
 * @property {number} avg_fail_rate 0..1
 * @property {number} flaky_runs
 * @property {number} consistently_failing_runs
 * @property {number} pass_runs
 * @property {number} informational_runs
 * @property {number} quarantine_candidate_runs
 * @property {string} last_seen ISO
 * @property {string} first_seen ISO
 * @property {number} score ranking score (internal)
 */

/**
 * @typedef {Object} FlakyTrends
 * @property {number} window_days
 * @property {string} generated_at ISO
 * @property {TrendsTestRow[]} tests
 * @property {string[]} top_n
 * @property {{
 *   runs_considered: number,
 *   unique_tests: number,
 *   flaky_runs: number,
 *   consistently_failing_runs: number,
 *   pass_runs: number,
 *   informational_runs: number,
 *   quarantine_candidate_runs: number
 * }} totals
 */

/**
 * @typedef {Object} ExportResult
 * @property {FlakySummaryRow[]} summary
 * @property {{ trends7: FlakyTrends, trends30: FlakyTrends }} trends
 * @property {RunMetadata} metadata
 * @property {string|null=} mdSummaryPath
 */

/** Parse CLI args (minimal deterministic parser). */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/** Safe JSON read with clear error messages. */
function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required JSON file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e?.message ?? String(e)}`);
  }
}

/**
 * Optional JSON read:
 * - returns null if missing
 * - throws if exists but invalid JSON (signal corruption)
 */
function readJsonFileOptional(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e?.message ?? String(e)}`);
  }
}

/** Write JSON with stable formatting. */
function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** Write text with safe directory creation. */
function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Convert string to boolean (accept true/false/1/0). */
function toBool(s, def) {
  if (s === undefined) return def;
  const v = String(s).toLowerCase().trim();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return def;
}

/** Clamp integer safely. */
function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** ISO timestamp helper. */
function isoNow() {
  return new Date().toISOString();
}

/** YYYY-MM-DD in UTC for audit folder naming. */
function utcDateStamp(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Best-effort PR number extraction:
 * - Works if user passes --pr 42
 * - Or if branch looks like "refs/pull/42/merge"
 */
function inferPrNumber(explicit) {
  if (explicit && /^\d+$/.test(explicit)) return parseInt(explicit, 10);
  const ref = process.env.GITHUB_REF ?? "";
  const m = ref.match(/refs\/pull\/(\d+)\/merge/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Normalize classification strings coming from evaluate-flaky output. */
function normalizeClassification(raw, failRate) {
  const s = String(raw ?? "").toLowerCase().trim();

  if (s === "pass" || s === "passed" || s === "success") return "pass";
  if (s === "informational" || s === "info") return "informational";
  if (s === "flaky") return "flaky";
  if (s === "quarantine-candidate" || s === "quarantine" || s === "candidate")
    return "quarantine-candidate";

  if (failRate >= 0.999) return "consistently-failing";
  return "unknown";
}

/**
 * Find historical flaky-summary.json files under .audit/**flaky/flaky-summary.json
 * without 
 */
function findHistoricalSummaries(auditRoot, maxDepth = 10) {
  /** @type {string[]} */
  const results = [];
  if (!fs.existsSync(auditRoot)) return results;

  function walk(dir, depth) {
    if (depth > maxDepth) return;

    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        if (
          ent.name === "flaky-summary.json" &&
          full.includes(`${path.sep}flaky${path.sep}`)
        ) {
          results.push(full);
        }
      }
    }
  }

  walk(auditRoot, 0);
  return results;
}

/** Parse summary rows from historical file (supports array or object wrapper). */
function parseHistoricalFile(filePath) {
  const j = readJsonFile(filePath);

  const arr = Array.isArray(j)
    ? j
    : typeof j === "object" && j !== null && Array.isArray(j.summaries)
      ? j.summaries
      : typeof j === "object" && j !== null && Array.isArray(j.summary)
        ? j.summary
        : null;

  if (!arr) return [];

  /** @type {FlakySummaryRow[]} */
  const rows = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    if (!item.suite || !item.generated_at) continue;

    // test_name is required for per-key aggregation; for suite-level evidence we still set it.
    const testName = String(item.test_name ?? "(suite-level)");
    if (!testName) continue;

    const pass = Number(item.pass_count ?? 0);
    const fail = Number(item.fail_count ?? 0);
    const total = Number(
      item.total ??
        Math.max(1, pass + fail)
    );
    const failRate = Number(item.fail_rate ?? (total > 0 ? fail / total : 0));

    rows.push({
      run_id: String(item.run_id ?? "unknown"),
      repo: String(item.repo ?? "unknown"),
      suite: String(item.suite),
      test_name: testName,
      pass_count: pass,
      fail_count: fail,
      total,
      fail_rate: Number(failRate.toFixed(6)),
      classification: normalizeClassification(item.classification, failRate),
      first_seen: String(item.first_seen ?? item.generated_at),
      last_seen: String(item.last_seen ?? item.generated_at),
      generated_at: String(item.generated_at),
    });
  }

  return rows;
}

/**
 * Build current run summary rows from:
 *   - summaryPath (optional): summary.json OR summary.normalized.json
 *   - evaluationPath (optional): evaluation.json
 *
 * If evaluation is missing:
 *   - returns [] (caller may still write empty audit artifacts for traceability)
 */
function buildCurrentRunRows(params) {
  const runAt = params.metadata.generated_at;

  const rerun = readJsonFileOptional(params.summaryPath);
  const evalRaw = readJsonFileOptional(params.evaluationPath);

  if (evalRaw == null) return [];

  const evalItems = Array.isArray(evalRaw) ? evalRaw : [evalRaw];

  /** @type {FlakySummaryRow[]} */
  const rows = [];

  for (const item of evalItems) {
    const suite = String(item?.suite ?? params.suite ?? "unknown").trim() || "unknown";

    // IMPORTANT: suite-level evidence should not emit "unknown-test"
    const testName = String(item?.test_name ?? "(suite-level)");

    // prefer evaluation counts, else summary.normalized.json fields, else 0
    const pass = Number(item?.pass_count ?? rerun?.pass_count ?? 0);
    const fail = Number(item?.fail_count ?? rerun?.fail_count ?? 0);

    // Support normalized or legacy shapes
    const totalRaw =
      item?.total ??
      rerun?.total_attempts ??
      rerun?.total ??
      (pass + fail);

    const total = Number(totalRaw ?? 1);

    const failRate =
      typeof item?.fail_rate === "number"
        ? item.fail_rate
        : total > 0
          ? fail / total
          : 0;

    const cls = normalizeClassification(item?.classification, failRate);

    rows.push({
      run_id: params.metadata.run_id,
      repo: params.metadata.repo,
      suite,
      test_name: testName,
      pass_count: pass,
      fail_count: fail,
      total,
      fail_rate: Number(Number(failRate).toFixed(6)),
      classification: cls,
      first_seen: runAt,
      last_seen: runAt,
      generated_at: runAt,
    });
  }

  return rows;
}

/** Filter rows whose generated_at is within `windowDays` of `now`. */
function filterWindow(rows, windowDays, now) {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return rows.filter((r) => {
    const t = Date.parse(r.generated_at);
    return Number.isFinite(t) && t >= cutoff;
  });
}

/** Compute rolling trends deterministically. */
function computeTrends(rows, windowDays, topN) {
  const now = new Date();
  const w = filterWindow(rows, windowDays, now);

  /** @type {Map<string, FlakySummaryRow[]>} */
  const byKey = new Map();
  for (const r of w) {
    const key = `${r.suite}::${r.test_name}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  /** @type {TrendsTestRow[]} */
  const tests = [];
  const totals = {
    runs_considered: w.length,
    unique_tests: byKey.size,
    flaky_runs: 0,
    consistently_failing_runs: 0,
    pass_runs: 0,
    informational_runs: 0,
    quarantine_candidate_runs: 0,
  };

  for (const [, arr] of byKey.entries()) {
    // stable ordering
    arr.sort((a, b) => a.generated_at.localeCompare(b.generated_at));

    const suite = arr[0].suite;
    const testName = arr[0].test_name;

    const runs = arr.length;
    const avgFail =
      arr.reduce((s, r) => s + Number(r.fail_rate ?? 0), 0) / Math.max(1, runs);

    let flakyRuns = 0;
    let failRuns = 0;
    let passRuns = 0;
    let infoRuns = 0;
    let quarRuns = 0;

    const firstSeen = arr[0].generated_at;
    const lastSeen = arr[arr.length - 1].generated_at;

    for (const r of arr) {
      if (r.classification === "flaky") flakyRuns++;
      if (r.classification === "consistently-failing") failRuns++;
      if (r.classification === "pass") passRuns++;
      if (r.classification === "informational") infoRuns++;
      if (r.classification === "quarantine-candidate") quarRuns++;
    }

    totals.flaky_runs += flakyRuns;
    totals.consistently_failing_runs += failRuns;
    totals.pass_runs += passRuns;
    totals.informational_runs += infoRuns;
    totals.quarantine_candidate_runs += quarRuns;

    // Ranking score: prefer recurring flake; then consistent fails (weighted)
    const scoreRaw = avgFail * flakyRuns + avgFail * 0.25 * failRuns;

    tests.push({
      suite,
      test_name: testName,
      runs,
      avg_fail_rate: Number(avgFail.toFixed(6)),
      flaky_runs: flakyRuns,
      consistently_failing_runs: failRuns,
      pass_runs: passRuns,
      informational_runs: infoRuns,
      quarantine_candidate_runs: quarRuns,
      first_seen: firstSeen,
      last_seen: lastSeen,
      score: Number(scoreRaw.toFixed(6)),
    });
  }

  tests.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.avg_fail_rate !== a.avg_fail_rate) return b.avg_fail_rate - a.avg_fail_rate;
    if (b.flaky_runs !== a.flaky_runs) return b.flaky_runs - a.flaky_runs;
    if (a.suite !== b.suite) return a.suite.localeCompare(b.suite);
    return a.test_name.localeCompare(b.test_name);
  });

  const top = tests.slice(0, topN).map((t) => t.test_name);

  return {
    window_days: windowDays,
    generated_at: isoNow(),
    tests,
    top_n: top,
    totals,
  };
}

/** Hydrate first_seen/last_seen for current run from history. */
function hydrateFirstLastSeen(current, history) {
  /** @type {Map<string, { first: string; last: string }>} */
  const byKey = new Map();

  for (const r of history) {
    const key = `${r.suite}::${r.test_name}`;
    const cur = byKey.get(key);
    const t = r.generated_at;
    if (!cur) byKey.set(key, { first: t, last: t });
    else {
      if (t < cur.first) cur.first = t;
      if (t > cur.last) cur.last = t;
    }
  }

  return current.map((r) => {
    const key = `${r.suite}::${r.test_name}`;
    const hl = byKey.get(key);
    if (!hl) return r;
    return { ...r, first_seen: hl.first, last_seen: hl.last };
  });
}

/** Render optional Markdown summary for PR visibility. */
function renderMarkdown(params) {
  const rows = params.current;

  const counts = {
    pass: rows.filter((r) => r.classification === "pass").length,
    informational: rows.filter((r) => r.classification === "informational").length,
    flaky: rows.filter((r) => r.classification === "flaky").length,
    quarantine: rows.filter((r) => r.classification === "quarantine-candidate").length,
    failing: rows.filter((r) => r.classification === "consistently-failing").length,
    unknown: rows.filter((r) => r.classification === "unknown").length,
  };

  const top7 = params.trends7.tests.slice(0, params.topN);
  const top30 = params.trends30.tests.slice(0, params.topN);

  const lines = [];
  lines.push(`# Flaky Analytics Summary (${params.suite})`);
  lines.push(``);
  lines.push(`**Current run classifications**`);
  lines.push(`- Pass: ${counts.pass}`);
  lines.push(`- Informational: ${counts.informational}`);
  lines.push(`- Flaky: ${counts.flaky}`);
  lines.push(`- Quarantine-candidate: ${counts.quarantine}`);
  lines.push(`- Consistently failing: ${counts.failing}`);
  if (counts.unknown > 0) lines.push(`- Unknown: ${counts.unknown}`);
  lines.push(``);

  function table(title, items) {
    lines.push(`## ${title}`);
    if (items.length === 0) {
      lines.push(`No historical data available in this window.`);
      lines.push(``);
      return;
    }
    lines.push(
      `| Rank | Test | Suite | Runs | Avg fail rate | Flaky runs | Failing runs | Last seen |`
    );
    lines.push(`|---:|---|---|---:|---:|---:|---:|---|`);
    items.forEach((t, i) => {
      lines.push(
        `| ${i + 1} | \`${t.test_name}\` | ${t.suite} | ${t.runs} | ${(
          t.avg_fail_rate * 100
        ).toFixed(1)}% | ${t.flaky_runs} | ${t.consistently_failing_runs} | ${t.last_seen} |`
      );
    });
    lines.push(``);
  }

  table(`Top ${params.topN} unstable tests (7 days)`, top7);
  table(`Top ${params.topN} unstable tests (30 days)`, top30);

  lines.push(`## Recommendations`);
  lines.push(
    `- Prioritize fixing the top 3 tests in 30-day window (highest recurring instability).`
  );
  lines.push(
    `- If a test is consistently failing (fail_rate=100%), treat it as a **broken contract**, not a flake.`
  );
  lines.push(
    `- If flakiness clusters in one suite, investigate shared setup/teardown, clocks, data isolation, and parallel hazards.`
  );
  lines.push(``);

  return lines.join("\n");
}

/** Resolve absolute-ish path deterministically. */
function resolvePathMaybe(baseDir, p) {
  if (!p) return "";
  // If already absolute, keep; else resolve relative to baseDir
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}

/** Main entrypoint. */
function main() {
  const args = parseArgs(process.argv);

  const suite = String(args["suite"] ?? "integ").trim();
  const auditRoot = String(args["audit-root"] ?? ".audit").trim();
  const outDir = String(args["out-dir"] ?? "out/flaky").trim();
  const topN = clampInt(parseInt(args["top-n"] ?? "10", 10) || 10, 3, 50);
  const writeMd = toBool(args["write-md"], false);
  const pr = inferPrNumber(args["pr"]);

  // behavior flags
  const requireEnabled = toBool(args["require-enabled"], true);
  const allowMissingEval = toBool(args["allow-missing-evaluation"], true);
  const requireEvaluation = toBool(args["require-evaluation"], false);

  const flakyDetectEnv = String(process.env.FLAKY_DETECT ?? "false").toLowerCase();
  const flakyEnabled = flakyDetectEnv === "true" || flakyDetectEnv === "1";

  if (requireEnabled && !flakyEnabled) {
    console.log("[FLAKY-ANALYTICS] FLAKY_DETECT is not enabled; skipping export.");
    process.exit(0);
  }

  const generatedAt = isoNow();
  const repo = process.env.GITHUB_REPOSITORY ?? "unknown/unknown";
  const runId = process.env.GITHUB_RUN_ID ?? "local";

  /** @type {RunMetadata} */
  const metadata = {
    repo,
    run_id: `gh-${runId}`,
    workflow: process.env.GITHUB_WORKFLOW ?? undefined,
    actor: process.env.GITHUB_ACTOR ?? undefined,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? undefined,
    commit: process.env.GITHUB_SHA ?? undefined,
    branch: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF ?? undefined,
    pr,
    runtime: `node${String(process.versions.node ?? "0").split(".")[0]}`,
    generated_at: generatedAt,
  };

  // NEW: support explicit --input and --evaluation
  // Base: resolve relative paths against CWD to be deterministic in GH Actions
  const cwd = process.cwd();
  const inputArg = args["input"] ? String(args["input"]).trim() : "";
  const evaluationArg = args["evaluation"] ? String(args["evaluation"]).trim() : "";

  const effectiveSummaryPath = inputArg
    ? resolvePathMaybe(cwd, inputArg)
    : path.join(outDir, "summary.json"); // legacy default

  const effectiveEvalPath = evaluationArg
    ? resolvePathMaybe(cwd, evaluationArg)
    : path.join(outDir, "evaluation.json"); // legacy default

  const evaluationExists = fs.existsSync(effectiveEvalPath);

  if (!evaluationExists && requireEvaluation) {
    throw new Error(
      `[FLAKY-ANALYTICS] evaluation.json is required but missing at: ${effectiveEvalPath}`
    );
  }

  if (!evaluationExists && !allowMissingEval) {
    throw new Error(
      `[FLAKY-ANALYTICS] evaluation.json missing at: ${effectiveEvalPath} (set --allow-missing-evaluation true to no-op)`
    );
  }

  // Load current rows (returns [] if evaluation missing)
  const currentRaw = buildCurrentRunRows({
    suite,
    outDir,
    metadata,
    summaryPath: effectiveSummaryPath,
    evaluationPath: effectiveEvalPath,
  });

  // Load historical
  const histPaths = findHistoricalSummaries(auditRoot);
  /** @type {FlakySummaryRow[]} */
  const history = [];
  for (const p of histPaths) {
    try {
      history.push(...parseHistoricalFile(p));
    } catch (e) {
      console.warn(
        `[FLAKY-ANALYTICS] WARN: could not parse ${p}: ${e?.message ?? String(e)}`
      );
    }
  }

  const current = hydrateFirstLastSeen(currentRaw, history);
  const all = [...history, ...current];

  const trends7 = computeTrends(all, 7, topN);
  const trends30 = computeTrends(all, 30, topN);

  const stamp = utcDateStamp(new Date());
  const auditDir = path.join(auditRoot, stamp, "flaky");

  const summaryOutPath = path.join(auditDir, "flaky-summary.json");
  const trendsOutPath = path.join(auditDir, "flaky-trends.json");
  const metaOutPath = path.join(auditDir, "metadata.json");

  // Always write audit artifacts (even if empty) for traceability
  writeJsonFile(summaryOutPath, current);
  writeJsonFile(trendsOutPath, { trends7, trends30 });
  writeJsonFile(metaOutPath, metadata);

  let mdPath = null;
  if (writeMd) {
    mdPath = path.join(outDir, "flaky-summary.md");
    const md = renderMarkdown({ suite, current, trends7, trends30, topN });
    writeTextFile(mdPath, md);
  }

  if (!evaluationExists) {
    console.log(
      `[FLAKY-ANALYTICS] ℹ️ No evaluation.json found at ${effectiveEvalPath} (empty shard or no evidence). Wrote empty audit artifacts.`
    );
  }

  console.log(`[FLAKY-ANALYTICS] ✅ Exported:`);
  console.log(`- ${summaryOutPath}`);
  console.log(`- ${trendsOutPath}`);
  console.log(`- ${metaOutPath}`);
  if (mdPath) console.log(`- ${mdPath}`);

  /** @type {ExportResult} */
  const result = { summary: current, trends: { trends7, trends30 }, metadata, mdSummaryPath: mdPath };
  return result;
}

main();
