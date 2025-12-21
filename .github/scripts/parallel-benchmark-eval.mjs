/**
 * Evaluates a benchmark result against a baseline and enforces regression policy.
 *
 * Policy (v1):
 * - If benchmark static or dynamic wall_clock is >= slowdown_threshold_pct slower
 *   than baseline for the same mode, FAIL.
 *
 * Notes:
 * - Baseline is optional. If missing, evaluator prints a notice and passes.
 *   (Alternative: fail-closed. Change behavior if you prefer stricter governance.)
 *
 * Expected JSON:
 * - benchmark: .audit/latest/parallel-benchmark.json
 * - baseline : .audit/parallel-benchmark-baseline.json
 */

import fs from "fs";

function parseArgs() {
  const args = new Map();
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i];
    if (!k.startsWith("--")) continue;
    const v = raw[i + 1] && !raw[i + 1].startsWith("--") ? raw[++i] : "true";
    args.set(k.replace(/^--/, ""), v);
  }
  return args;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function getModeWallClock(json, mode) {
  const m = json.modes?.find((x) => x.mode === mode);
  const r = m?.runs?.[0];
  return typeof r?.wall_clock_ms === "number" ? r.wall_clock_ms : null;
}

function pctSlower(newMs, baseMs) {
  if (!baseMs || baseMs <= 0) return null;
  return ((newMs - baseMs) / baseMs) * 100;
}

async function main() {
  const args = parseArgs();
  const benchPath = args.get("benchmark-json");
  const basePath = args.get("baseline-json");
  const threshold = Number(args.get("slowdown-threshold-pct") ?? "15");

  if (!benchPath) throw new Error("--benchmark-json is required");
  if (!fs.existsSync(benchPath)) throw new Error(`Benchmark json missing: ${benchPath}`);

  const bench = readJson(benchPath);

  if (!basePath || !fs.existsSync(basePath)) {
    console.log(`[BENCH-EVAL] No baseline found (${basePath ?? "unset"}). Passing (absolute-only).`);
    return;
  }

  const base = readJson(basePath);

  const modesToCheck = ["serial", "static", "dynamic"].filter((m) => getModeWallClock(bench, m) != null);

  const violations = [];

  for (const mode of modesToCheck) {
    const b = getModeWallClock(bench, mode);
    const bb = getModeWallClock(base, mode);

    // If baseline doesn't have a matching mode, skip it.
    if (bb == null) continue;

    const slower = pctSlower(b, bb);
    if (slower == null) continue;

    if (slower >= threshold) {
      violations.push({
        mode,
        benchmark_ms: b,
        baseline_ms: bb,
        slowdown_pct: slower,
        threshold_pct: threshold,
      });
    }
  }

  if (violations.length > 0) {
    console.error(`[BENCH-EVAL] ❌ Regression detected (>=${threshold}% slowdown):`);
    for (const v of violations) {
      console.error(
        `  - ${v.mode}: +${v.slowdown_pct.toFixed(2)}% (baseline=${v.baseline_ms}ms, bench=${v.benchmark_ms}ms)`
      );
    }
    process.exit(1);
  }

  console.log(`[BENCH-EVAL] ✅ No regressions detected (threshold=${threshold}%).`);
}

main().catch((err) => {
  console.error(`[BENCH-EVAL] ERROR: ${err?.stack || err}`);
  process.exit(1);
});
