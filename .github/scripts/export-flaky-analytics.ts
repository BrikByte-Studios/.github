/**
 * BrikByteOS — Flaky Analytics Exporter
 * ------------------------------------------------------------
 * TASK: PIPE-FLAKY-ANALYTICS-INTEG-003
 *
 * Purpose
 *   - Read current run flaky evidence:
 *       out/flaky/summary.json (rerun attempts evidence)
 *       out/flaky/evaluation.json (policy classification)
 *   - Load historical per-run summaries from:
 *       .audit/**flaky/flaky-summary.json
 *   - Compute rolling 7/30-day trends and Top-N unstable tests.
 *   - Export auditable JSON evidence under:
 *       .audit/YYYY-MM-DD/flaky/
 *         - flaky-summary.json
 *         - flaky-trends.json
 *         - metadata.json
 *   - Optionally render a human-readable Markdown summary:
 *       out/flaky/flaky-summary.md
 *
 * Determinism rules
 *   - Stable grouping key: `${suite}::${test_name}`
 *   - Window filtering by generated_at timestamp
 *   - Sorting is stable and explicit (tie-breakers included)
 *
 * Usage
 *   node .github/scripts/export-flaky-analytics.ts \
 *     --suite integ \
 *     --audit-root .audit \
 *     --out-dir out/flaky \
 *     --top-n 10 \
 *     --write-md true
 *
 * Env
 *   - GitHub Actions (optional):
 *     GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA, GITHUB_REF_NAME,
 *     GITHUB_HEAD_REF, GITHUB_BASE_REF, GITHUB_ACTOR, GITHUB_WORKFLOW,
 *     GITHUB_RUN_ATTEMPT
 */

type Classification =
  | "pass"
  | "informational"
  | "flaky"
  | "quarantine-candidate"
  | "consistently-failing"
  | "unknown";

type RunMetadata = {
  repo: string;
  run_id: string;
  workflow?: string;
  actor?: string;
  attempt?: string;
  commit?: string;
  branch?: string;
  pr?: number | null;
  generated_at: string; // ISO
  runtime?: string; // e.g. node20
};

type CurrentSummaryInput = {
  total_attempts?: number;
  pass_count?: number;
  fail_count?: number;
  attempts?: Array<{ run: number; status: "pass" | "fail" | string }>;
  // allow extra fields, do not fail parsing
  [k: string]: unknown;
};

type EvaluationInput = {
  suite?: string;
  test_name?: string;
  classification?: string;
  fail_rate?: number;
  pass_count?: number;
  fail_count?: number;
  total?: number;
  policy?: Record<string, unknown>;
  [k: string]: unknown;
};

type FlakySummaryRow = {
  run_id: string;
  repo: string;
  suite: string;
  test_name: string;
  pass_count: number;
  fail_count: number;
  total: number;
  fail_rate: number; // 0..1
  classification: Classification;
  first_seen: string; // ISO
  last_seen: string; // ISO
  generated_at: string; // ISO (this run)
};

type TrendsTestRow = {
  test_name: string;
  suite: string;
  runs: number;
  avg_fail_rate: number; // 0..1
  flaky_runs: number;
  consistently_failing_runs: number;
  pass_runs: number;
  informational_runs: number;
  quarantine_candidate_runs: number;
  last_seen: string; // ISO
  first_seen: string; // ISO
  score: number; // ranking score used internally
};

type FlakyTrends = {
  window_days: number;
  generated_at: string;
  tests: TrendsTestRow[];
  top_n: string[];
  totals: {
    runs_considered: number;
    unique_tests: number;
    flaky_runs: number;
    consistently_failing_runs: number;
    pass_runs: number;
    informational_runs: number;
    quarantine_candidate_runs: number;
  };
};

type ExportResult = {
  summary: FlakySummaryRow[];
  trends7: FlakyTrends;
  trends30: FlakyTrends;
  metadata: RunMetadata;
  mdSummaryPath?: string | null;
};

import fs from "fs";
import path from "path";

/** Parse CLI args (minimal deterministic parser). */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
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
function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required JSON file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${(e as Error).message}`);
  }
}

/** Write JSON with stable formatting. */
function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** Write text with safe directory creation. */
function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Convert string to boolean (accept true/false/1/0). */
function toBool(s: string | undefined, def: boolean): boolean {
  if (s === undefined) return def;
  const v = s.toLowerCase().trim();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return def;
}

/** Clamp integer safely. */
function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** ISO timestamp helper. */
function isoNow(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD in UTC for audit folder naming. */
function utcDateStamp(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Best-effort PR number extraction:
 * - Works if user passes --pr 42
 * - Or if branch looks like "refs/pull/42/merge" (rare in reusable workflows)
 */
function inferPrNumber(explicit: string | undefined): number | null {
  if (explicit && /^\d+$/.test(explicit)) return parseInt(explicit, 10);
  const ref = process.env.GITHUB_REF ?? "";
  const m = ref.match(/refs\/pull\/(\d+)\/merge/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Normalize classification strings coming from evaluate-flaky.ts. */
function normalizeClassification(raw: unknown, failRate: number): Classification {
  const s = String(raw ?? "").toLowerCase().trim();

  if (s === "pass" || s === "passed" || s === "success") return "pass";
  if (s === "informational" || s === "info") return "informational";
  if (s === "flaky") return "flaky";
  if (s === "quarantine-candidate" || s === "quarantine" || s === "candidate")
    return "quarantine-candidate";

  // If evaluation is missing/unknown, infer consistently-failing if fail_rate==1.
  if (failRate >= 0.999) return "consistently-failing";
  return "unknown";
}

/**
 * Find historical flaky-summary.json files under .audit/**flaky/flaky-summary.json
 * without requiring glob deps.
 *
 * Notes:
 *   - Deterministic traversal order: lexical sort.
 *   - Limits depth to avoid huge trees (default 8 levels).
 */
function findHistoricalSummaries(
  auditRoot: string,
  maxDepth = 8
): string[] {
  const results: string[] = [];
  if (!fs.existsSync(auditRoot)) return results;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // quick skip for node_modules or huge folders
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        // match .../.audit/<date>/flaky/flaky-summary.json
        if (ent.name === "flaky-summary.json" && full.includes(`${path.sep}flaky${path.sep}`)) {
          results.push(full);
        }
      }
    }
  }

  walk(auditRoot, 0);
  return results;
}

/** Parse summary rows from historical file (supports array or object wrapper). */
function parseHistoricalFile(filePath: string): FlakySummaryRow[] {
  const j = readJsonFile<unknown>(filePath);

  // Allow either:
  //  1) array of rows
  //  2) { summaries: [...] }
  //  3) { summary: [...] }
  const arr =
    Array.isArray(j) ? j :
    (typeof j === "object" && j !== null && Array.isArray((j as any).summaries)) ? (j as any).summaries :
    (typeof j === "object" && j !== null && Array.isArray((j as any).summary)) ? (j as any).summary :
    null;

  if (!arr) return [];

  const rows: FlakySummaryRow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as any;

    // Minimal required fields
    if (!r.test_name || !r.suite || !r.generated_at) continue;

    rows.push({
      run_id: String(r.run_id ?? "unknown"),
      repo: String(r.repo ?? "unknown"),
      suite: String(r.suite),
      test_name: String(r.test_name),
      pass_count: Number(r.pass_count ?? 0),
      fail_count: Number(r.fail_count ?? 0),
      total: Number(r.total ?? Math.max(1, Number(r.pass_count ?? 0) + Number(r.fail_count ?? 0))),
      fail_rate: Number(r.fail_rate ?? 0),
      classification: normalizeClassification(r.classification, Number(r.fail_rate ?? 0)),
      first_seen: String(r.first_seen ?? r.generated_at),
      last_seen: String(r.last_seen ?? r.generated_at),
      generated_at: String(r.generated_at),
    });
  }

  return rows;
}

/**
 * Build current run summary rows from:
 *   out/flaky/summary.json      (attempts evidence)
 *   out/flaky/evaluation.json   (classification + key names)
 *
 * Supports:
 *   - evaluation.json as a single object OR array of test objects.
 *   - summary.json attempt counts.
 */
function buildCurrentRunRows(params: {
  suite: string;
  outDir: string;
  metadata: RunMetadata;
}): FlakySummaryRow[] {
  const summaryPath = path.join(params.outDir, "summary.json");
  const evalPath = path.join(params.outDir, "evaluation.json");

  const runAt = params.metadata.generated_at;

  const rerun = fs.existsSync(summaryPath)
    ? readJsonFile<CurrentSummaryInput>(summaryPath)
    : null;

  const evalRaw = readJsonFile<unknown>(evalPath);

  const evalItems: EvaluationInput[] = Array.isArray(evalRaw)
    ? (evalRaw as EvaluationInput[])
    : [evalRaw as EvaluationInput];

  const rows: FlakySummaryRow[] = [];

  for (const item of evalItems) {
    const testName = String(item.test_name ?? "unknown-test");
    const suite = String(item.suite ?? params.suite);

    // prefer evaluation counts, else rerun summary counts, else fallback
    const pass = Number(item.pass_count ?? rerun?.pass_count ?? 0);
    const fail = Number(item.fail_count ?? rerun?.fail_count ?? 0);
    const total = Number(item.total ?? rerun?.total_attempts ?? (pass + fail) || 1);

    const failRate =
      typeof item.fail_rate === "number"
        ? item.fail_rate
        : total > 0 ? (fail / total) : 0;

    const cls = normalizeClassification(item.classification, failRate);

    rows.push({
      run_id: params.metadata.run_id,
      repo: params.metadata.repo,
      suite,
      test_name: testName,
      pass_count: pass,
      fail_count: fail,
      total,
      fail_rate: Number(failRate.toFixed(6)),
      classification: cls,
      first_seen: runAt, // overwritten later when merging history
      last_seen: runAt,
      generated_at: runAt,
    });
  }

  return rows;
}

/** Filter rows whose generated_at is within `windowDays` of `now`. */
function filterWindow(rows: FlakySummaryRow[], windowDays: number, now: Date): FlakySummaryRow[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return rows.filter(r => {
    const t = Date.parse(r.generated_at);
    return Number.isFinite(t) && t >= cutoff;
  });
}

/**
 * Compute trends:
 *   - runs per test
 *   - avg_fail_rate
 *   - classification counts
 *   - top_n ranking score = avg_fail_rate * flaky_runs (default) + small penalty for consistently failing
 *
 * Sorting is deterministic:
 *   - score desc
 *   - avg_fail_rate desc
 *   - flaky_runs desc
 *   - suite asc
 *   - test_name asc
 */
function computeTrends(rows: FlakySummaryRow[], windowDays: number, topN: number): FlakyTrends {
  const now = new Date();
  const w = filterWindow(rows, windowDays, now);

  const byKey = new Map<string, FlakySummaryRow[]>();
  for (const r of w) {
    const key = `${r.suite}::${r.test_name}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const tests: TrendsTestRow[] = [];
  let totals = {
    runs_considered: w.length,
    unique_tests: byKey.size,
    flaky_runs: 0,
    consistently_failing_runs: 0,
    pass_runs: 0,
    informational_runs: 0,
    quarantine_candidate_runs: 0,
  };

  for (const [key, arr] of byKey.entries()) {
    // stable order inside group
    arr.sort((a, b) => a.generated_at.localeCompare(b.generated_at));

    const suite = arr[0].suite;
    const testName = arr[0].test_name;

    const runs = arr.length;
    const avgFail = arr.reduce((s, r) => s + r.fail_rate, 0) / Math.max(1, runs);

    let flakyRuns = 0;
    let failRuns = 0;
    let passRuns = 0;
    let infoRuns = 0;
    let quarRuns = 0;

    let firstSeen = arr[0].generated_at;
    let lastSeen = arr[arr.length - 1].generated_at;

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

    // Ranking score: prioritize unstable patterns (flaky), but don’t ignore always-failing tests.
    // - avgFail in [0..1]
    // - flakyRuns increases priority
    // - failRuns adds small boost because consistent failures are also urgent (but different from flake)
    const scoreRaw = (avgFail * flakyRuns) + (avgFail * 0.25 * failRuns);

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

  const top = tests.slice(0, topN).map(t => t.test_name);

  return {
    window_days: windowDays,
    generated_at: isoNow(),
    tests,
    top_n: top,
    totals,
  };
}

/**
 * Merge current run rows with historical rows to compute first_seen/last_seen per test.
 * This ensures the per-run summary includes continuity timestamps.
 */
function hydrateFirstLastSeen(
  current: FlakySummaryRow[],
  history: FlakySummaryRow[]
): FlakySummaryRow[] {
  const byKey = new Map<string, { first: string; last: string }>();

  for (const r of history) {
    const key = `${r.suite}::${r.test_name}`;
    const cur = byKey.get(key);
    const t = r.generated_at;
    if (!cur) {
      byKey.set(key, { first: t, last: t });
    } else {
      if (t < cur.first) cur.first = t;
      if (t > cur.last) cur.last = t;
    }
  }

  return current.map(r => {
    const key = `${r.suite}::${r.test_name}`;
    const hl = byKey.get(key);
    if (!hl) return r;
    return {
      ...r,
      first_seen: hl.first,
      last_seen: hl.last,
    };
  });
}

/** Render optional Markdown summary for PR visibility. */
function renderMarkdown(params: {
  suite: string;
  current: FlakySummaryRow[];
  trends7: FlakyTrends;
  trends30: FlakyTrends;
  topN: number;
}): string {
  const rows = params.current;

  const counts = {
    pass: rows.filter(r => r.classification === "pass").length,
    informational: rows.filter(r => r.classification === "informational").length,
    flaky: rows.filter(r => r.classification === "flaky").length,
    quarantine: rows.filter(r => r.classification === "quarantine-candidate").length,
    failing: rows.filter(r => r.classification === "consistently-failing").length,
    unknown: rows.filter(r => r.classification === "unknown").length,
  };

  const top7 = params.trends7.tests.slice(0, params.topN);
  const top30 = params.trends30.tests.slice(0, params.topN);

  const lines: string[] = [];
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

  function table(title: string, items: TrendsTestRow[]) {
    lines.push(`## ${title}`);
    if (items.length === 0) {
      lines.push(`No historical data available in this window.`);
      lines.push(``);
      return;
    }
    lines.push(`| Rank | Test | Suite | Runs | Avg fail rate | Flaky runs | Failing runs | Last seen |`);
    lines.push(`|---:|---|---|---:|---:|---:|---:|---|`);
    items.forEach((t, i) => {
      lines.push(
        `| ${i + 1} | \`${t.test_name}\` | ${t.suite} | ${t.runs} | ${(t.avg_fail_rate * 100).toFixed(1)}% | ${t.flaky_runs} | ${t.consistently_failing_runs} | ${t.last_seen} |`
      );
    });
    lines.push(``);
  }

  table(`Top ${params.topN} unstable tests (7 days)`, top7);
  table(`Top ${params.topN} unstable tests (30 days)`, top30);

  lines.push(`## Recommendations`);
  lines.push(`- Prioritize fixing the top 3 tests in 30-day window (highest recurring instability).`);
  lines.push(`- If a test is consistently failing (fail_rate=100%), treat it as a **broken contract**, not a flake.`);
  lines.push(`- If flakiness clusters in one suite, investigate shared setup/teardown, clocks, data isolation, and parallel hazards.`);
  lines.push(``);

  return lines.join("\n");
}

function main(): ExportResult {
  const args = parseArgs(process.argv);

  const suite = (args["suite"] ?? "integ").trim(); // unit|integ|e2e (free text ok)
  const auditRoot = (args["audit-root"] ?? ".audit").trim();
  const outDir = (args["out-dir"] ?? "out/flaky").trim();
  const topN = clampInt(parseInt(args["top-n"] ?? "10", 10) || 10, 3, 50);
  const writeMd = toBool(args["write-md"], false);
  const pr = inferPrNumber(args["pr"]);

  // Hard gate for governance: only run when explicitly enabled in workflow
  // (workflows should set this to true only when FLAKY_DETECT=true)
  const requireEnabled = toBool(args["require-enabled"], true);
  const flakyDetectEnv = (process.env.FLAKY_DETECT ?? "false").toLowerCase();
  const flakyEnabled = flakyDetectEnv === "true" || flakyDetectEnv === "1";

  if (requireEnabled && !flakyEnabled) {
    // Deterministic no-op exit: do not write anything.
    console.log("[FLAKY-ANALYTICS] FLAKY_DETECT is not enabled; skipping export.");
    process.exit(0);
  }

  const generatedAt = isoNow();
  const repo = process.env.GITHUB_REPOSITORY ?? "unknown/unknown";
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const metadata: RunMetadata = {
    repo,
    run_id: `gh-${runId}`,
    workflow: process.env.GITHUB_WORKFLOW ?? undefined,
    actor: process.env.GITHUB_ACTOR ?? undefined,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? undefined,
    commit: process.env.GITHUB_SHA ?? undefined,
    branch: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF ?? undefined,
    pr,
    runtime: `node${process.versions.node.split(".")[0]}`,
    generated_at: generatedAt,
  };

  // Build current run summary rows
  const currentRaw = buildCurrentRunRows({ suite, outDir, metadata });

  // Load historical summaries (best-effort)
  const histPaths = findHistoricalSummaries(auditRoot);
  const history: FlakySummaryRow[] = [];
  for (const p of histPaths) {
    try {
      history.push(...parseHistoricalFile(p));
    } catch (e) {
      console.warn(`[FLAKY-ANALYTICS] WARN: could not parse ${p}: ${(e as Error).message}`);
    }
  }

  // Merge first/last seen into current
  const current = hydrateFirstLastSeen(currentRaw, history);

  // Compute trends on history + current (so this run contributes immediately)
  const all = [...history, ...current];

  const trends7 = computeTrends(all, 7, topN);
  const trends30 = computeTrends(all, 30, topN);

  // Write to .audit/YYYY-MM-DD/flaky/
  const stamp = utcDateStamp(new Date());
  const auditDir = path.join(auditRoot, stamp, "flaky");

  const summaryPath = path.join(auditDir, "flaky-summary.json");
  const trendsPath = path.join(auditDir, "flaky-trends.json");
  const metaPath = path.join(auditDir, "metadata.json");

  // Summary should be per-run; keep it small and auditable.
  writeJsonFile(summaryPath, current);

  // Trends: include both windows in one file for convenience (still deterministic).
  writeJsonFile(trendsPath, { trends7, trends30 });

  writeJsonFile(metaPath, metadata);

  let mdPath: string | null = null;
  if (writeMd) {
    mdPath = path.join(outDir, "flaky-summary.md");
    const md = renderMarkdown({
      suite,
      current,
      trends7,
      trends30,
      topN,
    });
    writeTextFile(mdPath, md);
  }

  console.log(`[FLAKY-ANALYTICS] ✅ Exported:`);
  console.log(`- ${summaryPath}`);
  console.log(`- ${trendsPath}`);
  console.log(`- ${metaPath}`);
  if (mdPath) console.log(`- ${mdPath}`);

  return { summary: current, trends7, trends30, metadata, mdSummaryPath: mdPath };
}

main();
