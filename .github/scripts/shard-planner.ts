/**
 * Deterministically generates shard-map.json for static or dynamic modes.
 *
 * Sources of weights:
 * - Historical timings (from .audit) when available
 * - Heuristics when history is missing (default weight=1; optional file size)
 *
 * Outputs:
 * - <out_dir>/shard-map.json
 * - <out_dir>/shard-planner-metadata.json
 *
 * Safety:
 * - Planner can fail without breaking pipelines (workflow should fallback to static)
 * - Every input item must be assigned exactly once
 * - Tie-breaking is deterministic (lowest shard index)
 * -----------------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "path";
import crypto from "crypto";

type Mode = "static" | "dynamic";

type PlannerArgs = {
  mode: Mode;
  shardCount: number;
  testType?: string; // unit|integration|e2e|performance (optional, helps find history)
  seed?: string; // optional deterministic seed (NOT random)
  items: string[]; // required
  historyPath?: string; // optional explicit timings/results path
  auditRoot?: string; // default ".audit"
  outDir?: string; // default "out"
  workdir?: string; // repo or service workdir; used for file-size heuristic
};

type HistoryIndex = Record<string, number>; // id -> duration_ms

type ShardItem = {
  id: string;
  weight_ms: number;
  shard: number; // 0-based
  source: "history" | "heuristic";
};

type ShardMap = {
  mode: Mode;
  shard_count: number;
  items: ShardItem[];
  totals_ms: number[];
  source: {
    history_used: boolean;
    history_ref: string | null;
    heuristic: "default_1" | "file_size_bytes";
  };
  inputs: {
    test_type?: string;
    seed?: string;
    items_hash: string;
  };
  planner: {
    version: string;
    algorithm: string;
  };
};

const PLANNER_VERSION = "1.0.0";

function stableHash(obj: unknown): string {
  // Deterministic hash of inputs for traceability.
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ?? null;
}

function parseJsonFileSafe(p: string): any | null {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function csvToList(csv: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Attempts to build a duration index from common .audit formats:
 *  - timings.json: { "items": [{ "id": "...", "duration_ms": 123 } ...] }
 *  - results.json: { "tests": [{ "id": "...", "duration_ms": 123 } ...] }
 *  - simple map:   { "<id>": 123, ... }
 */
function buildHistoryIndex(historyJson: any): HistoryIndex {
  const idx: HistoryIndex = {};

  if (!historyJson || typeof historyJson !== "object") return idx;

  // Case: simple map { id: duration_ms }
  let looksLikeMap = true;
  for (const [k, v] of Object.entries(historyJson)) {
    if (typeof v !== "number") {
      looksLikeMap = false;
      break;
    }
    if (typeof k !== "string") {
      looksLikeMap = false;
      break;
    }
  }
  if (looksLikeMap) {
    for (const [k, v] of Object.entries(historyJson)) idx[k] = Number(v);
    return idx;
  }

  // Case: timings.json-like
  const items = Array.isArray(historyJson.items) ? historyJson.items : null;
  if (items) {
    for (const it of items) {
      if (it && typeof it.id === "string" && Number.isFinite(it.duration_ms)) {
        idx[it.id] = Number(it.duration_ms);
      }
    }
  }

  // Case: results.json-like
  const tests = Array.isArray(historyJson.tests) ? historyJson.tests : null;
  if (tests) {
    for (const t of tests) {
      if (t && typeof t.id === "string" && Number.isFinite(t.duration_ms)) {
        idx[t.id] = Number(t.duration_ms);
      }
    }
  }

  return idx;
}

/**
 * Finds the most recent timings file for a given test type under .audit.
 *
 * Expected patterns (examples):
 *  .audit/2025-12-10/e2e/timings.json
 *  .audit/2025-12-10/unit/timings.json
 *  .audit/2025-12-10/integration/results.json
 *
 * Returns:
 *  - { path, json } or null
 */
function findMostRecentHistory(auditRoot: string, testType?: string): { path: string; json: any } | null {
  if (!fs.existsSync(auditRoot)) return null;

  // list date dirs lexically; YYYY-MM-DD sorts naturally
  const dates = fs
    .readdirSync(auditRoot)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  const candidates: string[] = [];
  for (const d of dates) {
    if (testType) {
      candidates.push(path.join(auditRoot, d, testType, "timings.json"));
      candidates.push(path.join(auditRoot, d, testType, "results.json"));
    }
    // fallback: any test type (rare but helpful)
    candidates.push(path.join(auditRoot, d, "timings.json"));
    candidates.push(path.join(auditRoot, d, "results.json"));
  }

  for (const p of candidates) {
    const json = parseJsonFileSafe(p);
    if (json) return { path: p, json };
  }

  return null;
}

/**
 * Heuristic weights for when history is missing.
 *
 * v1 heuristic:
 *  - default 1
 *  - if item is a file that exists, use file size bytes (clamped to >=1)
 *
 * Note: file sizes are deterministic for a given commit; this is safe.
 */
function heuristicWeightMs(itemId: string, workdir: string): { weight: number; heuristic: "default_1" | "file_size_bytes" } {
  const candidate = path.isAbsolute(itemId) ? itemId : path.join(workdir, itemId);
  try {
    if (fs.existsSync(candidate)) {
      const st = fs.statSync(candidate);
      const w = Math.max(1, Math.floor(st.size)); // bytes as pseudo-ms
      return { weight: w, heuristic: "file_size_bytes" };
    }
  } catch {
    // ignore
  }
  return { weight: 1, heuristic: "default_1" };
}

function staticSlice(items: string[], shardCount: number): number[] {
  // Returns an array of shard assignments aligned to items index.
  // Deterministic: sorted items, then chunked.
  const n = items.length;
  const assignments = new Array<number>(n).fill(0);
  if (shardCount <= 1 || n === 0) return assignments;

  // chunk size ceiling
  const chunkSize = Math.ceil(n / shardCount);
  for (let i = 0; i < n; i++) {
    assignments[i] = Math.min(Math.floor(i / chunkSize), shardCount - 1);
  }
  return assignments;
}

function dynamicBinPack(items: { id: string; weight: number; source: "history" | "heuristic" }[], shardCount: number): { shard: number; totals: number[] }[] {
  // Deterministic greedy:
  //  - sort by weight desc, then id asc
  //  - assign to shard with smallest total (tie => lowest index)
  const totals = new Array<number>(shardCount).fill(0);
  const out: { id: string; weight: number; source: "history" | "heuristic"; shard: number }[] = [];

  const sorted = [...items].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.id.localeCompare(b.id);
  });

  for (const it of sorted) {
    // pick shard with min total; tie -> lowest index
    let best = 0;
    for (let s = 1; s < shardCount; s++) {
      if (totals[s] < totals[best]) best = s;
    }
    out.push({ ...it, shard: best });
    totals[best] += it.weight;
  }

  // We return mapping per item; caller will restore stable item order.
  return out.map((x) => ({ shard: x.shard, totals }));
}

function main() {
  const mode = (parseArg("--mode") as Mode | null) ?? "static";
  const shardCount = Number(parseArg("--shard-count") ?? "1");
  const testType = parseArg("--test-type") ?? undefined;
  const seed = parseArg("--seed") ?? undefined;

  const itemsCsv = parseArg("--items");
  const itemsFile = parseArg("--items-file");

  const historyPath = parseArg("--history-path") ?? undefined;

  const auditRoot = parseArg("--audit-root") ?? ".audit";
  const outDir = parseArg("--out-dir") ?? "out";
  const workdir = parseArg("--workdir") ?? process.cwd();

  // Required items:
  let items: string[] = [];
  if (itemsCsv) items = csvToList(itemsCsv);
  if (items.length === 0 && itemsFile && fs.existsSync(itemsFile)) {
    const raw = fs.readFileSync(itemsFile, "utf-8");
    items = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  if (!Number.isFinite(shardCount) || shardCount <= 0) {
    console.error("shard-planner: --shard-count must be a positive integer.");
    process.exit(2);
  }
  if (items.length === 0) {
    console.error("shard-planner: no items provided. Use --items or --items-file.");
    process.exit(2);
  }

  // Deterministic canonical ordering baseline: lexical sort.
  // Seed exists for future deterministic variations; v1 does not randomize.
  const canonicalItems = [...items].sort((a, b) => a.localeCompare(b));

  // Load history index (optional).
  let historyRef: string | null = null;
  let historyUsed = false;
  let historyIndex: HistoryIndex = {};

  if (historyPath) {
    const json = parseJsonFileSafe(historyPath);
    if (json) {
      historyRef = historyPath;
      historyIndex = buildHistoryIndex(json);
      historyUsed = Object.keys(historyIndex).length > 0;
    }
  } else {
    const found = findMostRecentHistory(auditRoot, testType);
    if (found) {
      historyRef = found.path;
      historyIndex = buildHistoryIndex(found.json);
      historyUsed = Object.keys(historyIndex).length > 0;
    }
  }

  // Build weighted list
  let heuristicType: "default_1" | "file_size_bytes" = "default_1";

  const weighted = canonicalItems.map((id) => {
    const dur = historyIndex[id];
    if (Number.isFinite(dur) && dur > 0) {
      return { id, weight: Math.floor(dur), source: "history" as const };
    }
    const h = heuristicWeightMs(id, workdir);
    if (h.heuristic === "file_size_bytes") heuristicType = "file_size_bytes";
    return { id, weight: h.weight, source: "heuristic" as const };
  });

  // Compute assignments
  let itemsOut: ShardItem[] = [];
  let totals = new Array<number>(shardCount).fill(0);

  if (mode === "static") {
    const assigns = staticSlice(canonicalItems, shardCount);
    itemsOut = canonicalItems.map((id, i) => {
      const src = weighted[i].source;
      const w = weighted[i].weight;
      const shard = assigns[i];
      totals[shard] += w;
      return { id, weight_ms: w, shard, source: src };
    });
  } else {
    // dynamic
    // Deterministic greedy bin packing, then restore stable item order.
    const packed = (() => {
      const totalsLocal = new Array<number>(shardCount).fill(0);
      const sortedByWeight = [...weighted].sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.id.localeCompare(b.id);
      });

      const assigned: Record<string, number> = {};
      for (const it of sortedByWeight) {
        let best = 0;
        for (let s = 1; s < shardCount; s++) {
          if (totalsLocal[s] < totalsLocal[best]) best = s;
        }
        assigned[it.id] = best;
        totalsLocal[best] += it.weight;
      }

      return { assigned, totalsLocal };
    })();

    totals = packed.totalsLocal;
    itemsOut = canonicalItems.map((id) => {
      const w = weighted.find((x) => x.id === id)!;
      return { id, weight_ms: w.weight, shard: packed.assigned[id], source: w.source };
    });
  }

  // Validate coverage: every item assigned exactly once
  const assignedSet = new Set(itemsOut.map((x) => x.id));
  if (assignedSet.size !== canonicalItems.length) {
    console.error("shard-planner: invalid mapping: missing or duplicate item assignments.");
    process.exit(3);
  }

  const shardMap: ShardMap = {
    mode,
    shard_count: shardCount,
    items: itemsOut,
    totals_ms: totals,
    source: {
      history_used: historyUsed,
      history_ref: historyUsed ? historyRef : null,
      heuristic: heuristicType,
    },
    inputs: {
      test_type: testType,
      seed,
      items_hash: stableHash({ mode, shardCount, testType, seed, items: canonicalItems }),
    },
    planner: {
      version: PLANNER_VERSION,
      algorithm: mode === "dynamic" ? "deterministic_greedy_binpack" : "deterministic_slice",
    },
  };

  ensureDir(outDir);
  const outPath = path.join(outDir, "shard-map.json");
  fs.writeFileSync(outPath, JSON.stringify(shardMap, null, 2), "utf-8");
  console.log(`✅ shard-planner wrote ${outPath}`);
  console.log(`   mode=${mode} shards=${shardCount} history_used=${historyUsed} heuristic=${heuristicType}`);
  console.log(`   totals_ms=${JSON.stringify(totals)}`);
}

main();
