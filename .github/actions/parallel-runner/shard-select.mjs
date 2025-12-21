/**
 * shard-select.mjs
 *
 * Deterministically selects a subset of test files for a shard.
 *
 * Contract:
 * - SHARD_INDEX is 0-based
 * - SHARD_TOTAL is total shards
 *
 * Algorithm (stable + deterministic):
 * 1) Glob + sort file paths
 * 2) Select items where (fileIndex % total) === index
 *
 * Why this approach:
 * - deterministic (same inputs => same selection)
 * - debuggable (print counts + sample)
 * - simple, avoids "random shards" drift
 *
 * Usage:
 *   node .github/scripts/shard-select.mjs \
 *     --workdir node-api-example \
 *     --glob "tests/unit/**__WILDCARD__/*.test.js" \
 *     --index 0 --total 4 \
 *     --out out/shard-files.txt
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Use a tiny glob implementation via Node's built-in recursion.
// Avoid extra deps so this works in minimal environments.
import { readdirSync, statSync } from "fs";

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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Convert a very small subset of glob patterns into a RegExp.
 * Supported:
 * - ** for any nested directories
 * - *  for any characters except path separator
 * - ?  for single character
 *
 * This is intentionally minimal to avoid dependency weight.
 */
function globToRegExp(glob) {
  // Normalize slashes
  const g = glob.replace(/\\/g, "/");

  // Escape regex meta
  const escaped = g.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Convert glob tokens
  const withDoubleStar = escaped.replace(/\\\*\\\*/g, "###DOUBLESTAR###");
  const withStar = withDoubleStar.replace(/\\\*/g, "[^/]*");
  const withQ = withStar.replace(/\\\?/g, ".");
  const withDS = withQ.replace(/###DOUBLESTAR###/g, ".*");

  return new RegExp("^" + withDS + "$");
}

function walk(dirAbs) {
  const out = [];
  const entries = readdirSync(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      out.push(...walk(p));
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function relFrom(rootAbs, fileAbs) {
  return path.relative(rootAbs, fileAbs).replace(/\\/g, "/");
}

async function main() {
  const args = parseArgs();

  const workdir = args.get("workdir") ?? ".";
  const glob = args.get("glob");
  const index = Number(args.get("index"));
  const total = Number(args.get("total"));
  const outPath = args.get("out") ?? "out/shard-files.txt";

  if (!glob) throw new Error("--glob is required");
  if (!Number.isInteger(index) || index < 0) throw new Error("--index must be a 0-based integer");
  if (!Number.isInteger(total) || total < 1) throw new Error("--total must be an integer >= 1");
  if (index >= total) throw new Error("--index must be < --total");

  const repoRoot = process.cwd();
  const rootAbs = path.resolve(repoRoot, workdir);

  if (!fs.existsSync(rootAbs)) {
    throw new Error(`workdir does not exist: ${rootAbs}`);
  }

  const rx = globToRegExp(glob);

  // Walk all files under workdir and filter by glob
  const allAbs = walk(rootAbs);
  const allRel = allAbs.map((p) => relFrom(rootAbs, p));

  const matched = allRel
    .filter((p) => rx.test(p))
    .map((p) => p.replace(/\\/g, "/"))
    .sort((a, b) => a.localeCompare(b));

  if (matched.length === 0) {
    // Allow empty -> treat as "nothing to run", but still create output file.
    ensureDir(path.dirname(path.resolve(repoRoot, outPath)));
    fs.writeFileSync(outPath, "", "utf-8");
    console.log(`[SHARD-SELECT] glob matched 0 files; wrote empty list -> ${outPath}`);
    process.exit(0);
  }

  const selected = matched.filter((_, i) => i % total === index);

  ensureDir(path.dirname(path.resolve(repoRoot, outPath)));
  fs.writeFileSync(outPath, selected.join("\n") + (selected.length ? "\n" : ""), "utf-8");

  const sample = selected.slice(0, 12);
  console.log(`[SHARD-SELECT] workdir: ${workdir}`);
  console.log(`[SHARD-SELECT] glob   : ${glob}`);
  console.log(`[SHARD-SELECT] shard  : ${index}/${total} (0-based)`);
  console.log(`[SHARD-SELECT] total matched  : ${matched.length}`);
  console.log(`[SHARD-SELECT] selected count : ${selected.length}`);
  console.log(`[SHARD-SELECT] out: ${outPath}`);
  if (sample.length) {
    console.log(`[SHARD-SELECT] sample:`);
    for (const s of sample) console.log(`  - ${s}`);
  }
}

main().catch((err) => {
  console.error(`[SHARD-SELECT] ERROR: ${err?.stack || err}`);
  process.exit(1);
});
