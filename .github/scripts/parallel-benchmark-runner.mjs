/**
 * Creates a repeatable benchmark that compares:
 *   - serial execution
 *   - static parallel execution
 *   - dynamic parallel execution (optional)
 *
 * Outputs:
 *   - <audit_root>/latest/parallel-benchmark.json      (normalized)
 *   - <audit_root>/latest/parallel-benchmark.raw.json  (raw with per-run details)
 *   - out/parallel-benchmark-summary.md                (human readable)
 *
 * Notes:
 * - This runner is language-agnostic. It relies on WORKLOAD presets that define:
 *     (1) how to generate test items (optional but recommended)
 *     (2) how to execute a mode (serial/static/dynamic)
 *     (3) where to find shard totals and whether history was used (optional)
 *
 * - In v1, REPEATS is supported but default is 1.
 * - Runner-minutes is estimated from wall-clock per job run (we're in a single job).
 *   For more precise runner-minutes across shard jobs, extend this runner to
 *   call the GitHub API and sum per-job durations (v2).
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

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

/**
 * Execute a command in a given cwd and return:
 * - exitCode
 * - stdout/stderr (trimmed for safety)
 * - start/end timestamps
 */
async function execTimed(cmd, cmdArgs, cwd, env = {}) {
  const start = Date.now();

  const child = spawn(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
  child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));

  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });

  const end = Date.now();

  // Avoid gigantic logs in artifacts; keep enough for debugging.
  const trim = (s) => (s.length > 4000 ? s.slice(0, 4000) + "\n...<trimmed>" : s);

  return {
    start_ts: new Date(start).toISOString(),
    end_ts: new Date(end).toISOString(),
    wall_clock_ms: end - start,
    exit_code: exitCode,
    passed: exitCode === 0,
    stdout: trim(stdout),
    stderr: trim(stderr),
  };
}

function mustExist(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing required path (${label}): ${p}`);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * WORKLOAD PRESETS
 * You can add more workloads as the org grows.
 *
 * Each workload defines:
 * - root: working directory relative to repo-root
 * - discoverItems: optional command to generate out/test-items.txt
 * - run: how to execute each mode
 *
 * IMPORTANT:
 * - For parallel modes we assume the repo's own CI entrypoints honor:
 *     PARALLEL_MODE=static|dynamic
 *     UNIT_SHARD / UNIT_SHARD_TOTAL (or language equivalent)
 * - For benchmark in a single job, we simulate shard totals by running shard loops
 *   sequentially (so we can compute imbalance). This is fine for benchmarking logic.
 */
function workloads() {
  return {
    "node-api-unit": {
      root: "node-api-example",
      discoverItems: ["bash", ["-lc", "mkdir -p out && node scripts/list-tests.cjs > out/test-items.txt || true"]],
      run: async ({ repoRoot, mode, shardCount }) => {
        const cwd = path.join(repoRoot, "node-api-example");
        ensureDir(path.join(cwd, "out"));

        // ⚠️ If npm ci is expensive, consider doing it once per mode (v2 improvement).
        if (mode === "serial") {
          return await execTimed("bash", ["-lc", "npm ci && npm test"], cwd, { PARALLEL_MODE: "serial" });
        }

        const shardTotals = [];
        let allPassed = true;
        let totalWall = 0;

        for (let i = 1; i <= shardCount; i++) {
          const r = await execTimed("bash", ["-lc", "npm ci && make test"], cwd, {
            PARALLEL_MODE: mode,
            UNIT_SHARD: String(i),
            UNIT_SHARD_TOTAL: String(shardCount),
          });
          shardTotals.push(r.wall_clock_ms);
          totalWall += r.wall_clock_ms;
          if (!r.passed) allPassed = false;
        }

        return { wall_clock_ms: totalWall, exit_code: allPassed ? 0 : 1, passed: allPassed, shard_totals_ms: shardTotals };
      },
    },

    "go-api-unit": {
      root: "go-api-example",
      discoverItems: ["bash", ["-lc", "mkdir -p out && go list ./... > out/test-items.txt || true"]],
      run: async ({ repoRoot, mode, shardCount }) => {
        const cwd = path.join(repoRoot, "go-api-example");
        ensureDir(path.join(cwd, "out"));

        if (mode === "serial") {
          return await execTimed("bash", ["-lc", "go test ./... -count=1"], cwd, { PARALLEL_MODE: "serial" });
        }

        const shardTotals = [];
        let allPassed = true;
        let totalWall = 0;

        for (let i = 1; i <= shardCount; i++) {
          const r = await execTimed("bash", ["-lc", "make test"], cwd, {
            PARALLEL_MODE: mode,
            UNIT_SHARD: String(i),
            UNIT_SHARD_TOTAL: String(shardCount),
          });
          shardTotals.push(r.wall_clock_ms);
          totalWall += r.wall_clock_ms;
          if (!r.passed) allPassed = false;
        }

        return { wall_clock_ms: totalWall, exit_code: allPassed ? 0 : 1, passed: allPassed, shard_totals_ms: shardTotals };
      },
    },

    "java-api-unit": {
      root: "java-api-example",
      discoverItems: [
        "bash",
        [
          "-lc",
          [
            "mkdir -p out",
            // Broader + more realistic than "*Test.java" at shallow depth.
            // Captures typical Maven/Gradle layouts.
            "find . -type f \\( -path '*/src/test/java/*' -o -path '*/test/*' \\) \\( -name '*Test.java' -o -name '*Tests.java' -o -name '*IT.java' \\) | sort > out/test-items.txt || true",
          ].join(" && "),
        ],
      ],
      run: async ({ repoRoot, mode, shardCount }) => {
        const cwd = path.join(repoRoot, "java-api-example");
        ensureDir(path.join(cwd, "out"));

        if (mode === "serial") {
          // Adjust to your repo: mvn test OR gradle test OR make test.
          // If your repo standard is Makefile-driven, use "make test" here instead.
          return await execTimed("bash", ["-lc", "mvn -q -DskipTests=false test"], cwd, {
            PARALLEL_MODE: "serial",
          });
        }

        const shardTotals = [];
        let allPassed = true;
        let totalWall = 0;

        // Assumes your Java example honors shard env vars inside make/mvn wrapper.
        // If not, replace with a shard runner that reads shard-map.json and runs selected tests.
        for (let i = 1; i <= shardCount; i++) {
          const r = await execTimed("bash", ["-lc", "make test"], cwd, {
            PARALLEL_MODE: mode,
            UNIT_SHARD: String(i),
            UNIT_SHARD_TOTAL: String(shardCount),
          });
          shardTotals.push(r.wall_clock_ms);
          totalWall += r.wall_clock_ms;
          if (!r.passed) allPassed = false;
        }

        return { wall_clock_ms: totalWall, exit_code: allPassed ? 0 : 1, passed: allPassed, shard_totals_ms: shardTotals };
      },
    },

    "python-api-unit": {
      root: "python-api-example",
      discoverItems: [
        "bash",
        [
          "-lc",
          [
            "mkdir -p out",
            "python -c \"import glob; tests=sorted(glob.glob('**/test_*.py', recursive=True)); print('\\\\n'.join(tests))\" > out/test-items.txt || true",
          ].join(" && "),
        ],
      ],
      run: async ({ repoRoot, mode, shardCount }) => {
        const cwd = path.join(repoRoot, "python-api-example");
        ensureDir(path.join(cwd, "out"));

        if (mode === "serial") {
          return await execTimed("bash", ["-lc", "pytest -q"], cwd, { PARALLEL_MODE: "serial" });
        }

        const shardTotals = [];
        let allPassed = true;
        let totalWall = 0;

        // Assumes your Python example honors shard env vars in a wrapper.
        // If not, replace with a runner that selects tests via shard-map.json.
        for (let i = 1; i <= shardCount; i++) {
          const r = await execTimed("bash", ["-lc", "make test"], cwd, {
            PARALLEL_MODE: mode,
            UNIT_SHARD: String(i),
            UNIT_SHARD_TOTAL: String(shardCount),
          });
          shardTotals.push(r.wall_clock_ms);
          totalWall += r.wall_clock_ms;
          if (!r.passed) allPassed = false;
        }

        return { wall_clock_ms: totalWall, exit_code: allPassed ? 0 : 1, passed: allPassed, shard_totals_ms: shardTotals };
      },
    },
  };
}


/**
 * Compute shard imbalance percentage:
 * ((max - min) / avg) * 100
 */
function shardImbalancePct(shardTotalsMs) {
  if (!shardTotalsMs || shardTotalsMs.length < 2) return null;
  const max = Math.max(...shardTotalsMs);
  const min = Math.min(...shardTotalsMs);
  const avg = shardTotalsMs.reduce((a, b) => a + b, 0) / shardTotalsMs.length;
  if (avg <= 0) return null;
  return ((max - min) / avg) * 100;
}

function pctChange(newVal, baseVal) {
  if (baseVal === 0) return null;
  return ((newVal - baseVal) / baseVal) * 100;
}

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? (a[mid - 1] + a[mid]) / 2 : a[mid];
}

function toMarkdownSummary(report) {
  const modes = report.modes;

  const row = (m) => {
    const run = m.runs[0];
    const wc = run.wall_clock_ms;
    const mins = (wc / 60000).toFixed(2);
    const pass = run.passed ? "✅" : "❌";
    const imb = run.shard_imbalance_pct == null ? "—" : `${run.shard_imbalance_pct.toFixed(2)}%`;
    const hist = run.history_used == null ? "—" : run.history_used ? "yes" : "no";
    return `| ${m.mode} | ${pass} | ${wc} | ${mins} | ${imb} | ${hist} |`;
  };

  return [
    `# Parallel Benchmark Summary`,
    ``,
    `**timestamp:** ${report.timestamp}`,
    `**workload:** ${report.workload.id} (shards=${report.workload.shard_count})`,
    ``,
    `| mode | pass | wall_clock_ms | runner_minutes_est | shard_imbalance | history_used |`,
    `|---|---:|---:|---:|---:|---:|`,
    ...modes.map(row),
    ``,
    `## Comparisons`,
    ``,
    `- static vs serial improvement: **${report.comparisons.static_vs_serial_wall_clock_improvement_pct?.toFixed?.(2) ?? "n/a"}%**`,
    `- dynamic vs serial improvement: **${report.comparisons.dynamic_vs_serial_wall_clock_improvement_pct?.toFixed?.(2) ?? "n/a"}%**`,
    ``,
    `## Regression Policy`,
    ``,
    `- slowdown_threshold_pct: **${report.regression_policy.slowdown_threshold_pct}%**`,
    ``,
  ].join("\n");
}

async function main() {
  const args = parseArgs();

  const repoRoot = args.get("repo-root");
  const workloadId = args.get("workload");
  const shardCount = Number(args.get("shard-count") ?? "4");
  const enableDynamic = String(args.get("enable-dynamic") ?? "true") === "true";
  const repeats = Number(args.get("repeats") ?? "1");
  const auditRoot = args.get("audit-root") ?? ".audit";
  const outMd = args.get("out-md") ?? "out/parallel-benchmark-summary.md";

  if (!repoRoot) throw new Error("--repo-root is required");
  if (!workloadId) throw new Error("--workload is required");

  const wl = workloads()[workloadId];
  if (!wl) {
    throw new Error(
      `Unknown workload '${workloadId}'. Add it to workloads() in parallel-benchmark-runner.mjs.`
    );
  }

  mustExist(repoRoot, "repo-root");
  const wlRoot = path.join(repoRoot, wl.root);
  mustExist(wlRoot, `workload root (${wl.root})`);

  ensureDir(path.dirname(outMd));
  ensureDir(path.join(auditRoot, "latest"));

  // Optional discovery step (best-effort)
  if (wl.discoverItems) {
    try {
      await execTimed(wl.discoverItems[0], wl.discoverItems[1], wlRoot);
    } catch {
      // Non-blocking: benchmark can still run without a list in v1.
    }
  }

  const modesToRun = ["serial", "static", ...(enableDynamic ? ["dynamic"] : [])];

  const raw = {
    timestamp: new Date().toISOString(),
    workload: { id: workloadId, repo_root: repoRoot, shard_count: shardCount },
    modes: [],
  };

  for (const mode of modesToRun) {
    const runs = [];
    for (let i = 0; i < repeats; i++) {
      const r = await wl.run({ repoRoot, mode, shardCount });
      const shardImb = shardImbalancePct(r.shard_totals_ms);

      runs.push({
        wall_clock_ms: r.wall_clock_ms,
        passed: !!r.passed,
        runner_minutes_estimate: r.wall_clock_ms / 60000,
        shard_totals_ms: r.shard_totals_ms ?? null,
        shard_imbalance_pct: shardImb,
        // Placeholder for dynamic history usage if your shard planner exports it later
        history_used: mode === "dynamic" ? null : null,
      });
    }
    raw.modes.push({ mode, runs });
  }

  // Normalize (v1 = median across repeats; default repeats=1)
  const getMedianWc = (mode) => {
    const m = raw.modes.find((x) => x.mode === mode);
    if (!m) return null;
    return median(m.runs.map((r) => r.wall_clock_ms));
  };

  const serialMedian = getMedianWc("serial");
  const staticMedian = getMedianWc("static");
  const dynamicMedian = enableDynamic ? getMedianWc("dynamic") : null;

  const normalized = {
    timestamp: raw.timestamp,
    workload: raw.workload,
    modes: raw.modes.map((m) => ({
      mode: m.mode,
      runs: [
        {
          ...m.runs[0],
          // Keep v1 normalized as the first run; raw contains all.
        },
      ],
    })),
    comparisons: {
      static_vs_serial_wall_clock_improvement_pct:
        serialMedian != null && staticMedian != null ? -pctChange(staticMedian, serialMedian) : null,
      dynamic_vs_serial_wall_clock_improvement_pct:
        serialMedian != null && dynamicMedian != null ? -pctChange(dynamicMedian, serialMedian) : null,
    },
    regression_policy: {
      slowdown_threshold_pct: 15,
    },
    result: "unknown",
  };

  const md = toMarkdownSummary(normalized);

  fs.writeFileSync(path.join(auditRoot, "latest", "parallel-benchmark.raw.json"), JSON.stringify(raw, null, 2));
  fs.writeFileSync(path.join(auditRoot, "latest", "parallel-benchmark.json"), JSON.stringify(normalized, null, 2));
  fs.writeFileSync(outMd, md);

  console.log(`[BENCH] Wrote ${path.join(auditRoot, "latest", "parallel-benchmark.json")}`);
  console.log(`[BENCH] Wrote ${outMd}`);
}

main().catch((err) => {
  console.error(`[BENCH] ERROR: ${err?.stack || err}`);
  process.exit(1);
});
