#!/usr/bin/env node
/**
 * shard-select.mjs
 *
 * Deterministically selects a subset of test files for a shard.
 *
 * Contract:
 * - SHARD_INDEX is 0-based
 * - SHARD_TOTAL is total shards (>= 1)
 *
 * Algorithm (stable + deterministic):
 * 1) Glob + sort file paths
 * 2) Select items where (fileIndex % total) === index
 *
 * Usage (example):
 *   node shard-select.mjs \
 *     --workdir node-api-example \
 *     --glob "tests/unit/**/\\*.test.js" \
 *     --index 0 --total 4 \
 *     --out out/shard-files.txt
 *
 * NOTE:
 * - Avoid putting globs containing "**/" in a /* block comment */ because the
 *   substring "*/" can terminate the comment early in JavaScript.
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs() {
  const args = new Map();
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i];
    if (!k.startsWith("--")) continue;
    const v = raw[i + 1] && !raw[i + 1].startsWith("--") ? raw[++i] : "true";
    args.set(k.slice(2), v);
  }
  return args;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Convert a minimal subset of glob patterns into a RegExp.
 * Supported:
 * - **  => any nested directories
 * - *   => any characters except path separator
 * - ?   => exactly one character except path separator
 */
function globToRegExp(glob) {
  // Normalize slashes
  const g = glob.replace(/\\/g, "/");

  // Escape regex meta
  const escaped = g.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Protect ** first so the later * replacement doesn't interfere
  const DS = "__DOUBLE_STAR__";
  const protectedDS = escaped.replace(/\*\*/g, DS);

  // Single-star: any chars except '/'
  const withStar = protectedDS.replace(/\*/g, "[^/]*");

  // Question: exactly one char except '/'
  const withQ = withStar.replace(/\?/g, "[^/]");

  // Restore **
  const finalSrc = withQ.replaceAll(DS, ".*");

  return new RegExp("^" + finalSrc + "$");
}

function walk(dirAbs) {
  const out = [];
  const stack = [dirAbs];

  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });

    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }

  return out;
}

function relFrom(rootAbs, fileAbs) {
  return path.relative(rootAbs, fileAbs).replace(/\\/g, "/");
}

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(2);
}

function main() {
  const args = parseArgs();

  const workdir = args.get("workdir") ?? ".";
  const glob = args.get("glob");
  const index = Number(args.get("index"));
  const total = Number(args.get("total"));
  const outPathRel = args.get("out") ?? "out/shard-files.txt";

  if (!glob) fail("--glob is required");
  if (!Number.isInteger(index) || index < 0) fail("--index must be a 0-based integer");
  if (!Number.isInteger(total) || total < 1) fail("--total must be an integer >= 1");
  if (index >= total) fail("--index must be < --total");

  const repoRoot = process.cwd();
  const rootAbs = path.resolve(repoRoot, workdir);

  if (!fs.existsSync(rootAbs)) fail(`workdir does not exist: ${rootAbs}`);

  const rx = globToRegExp(glob);

  // Walk all files under workdir, filter by glob, sort deterministically
  const matched = walk(rootAbs)
    .map((abs) => relFrom(rootAbs, abs))
    .filter((rel) => rx.test(rel))
    .sort((a, b) => a.localeCompare(b));

  const outAbs = path.resolve(repoRoot, outPathRel);
  ensureDir(path.dirname(outAbs));

  if (matched.length === 0) {
    fs.writeFileSync(outAbs, "", "utf-8");
    console.log(`[SHARD-SELECT] glob matched 0 files; wrote empty list -> ${outPathRel}`);
    process.exit(0);
  }

  const selected = matched.filter((_, i) => i % total === index);
  fs.writeFileSync(outAbs, selected.join("\n") + (selected.length ? "\n" : ""), "utf-8");

  // Log summary (debuggable + stable)
  const sample = selected.slice(0, 12);
  console.log("============================================================");
  console.log("🧩 [SHARD-SELECT] Deterministic file split");
  console.log(`  workdir        : ${workdir}`);
  console.log(`  glob           : ${glob}`);
  console.log(`  shard          : ${index}/${total} (0-based)`);
  console.log(`  total matched  : ${matched.length}`);
  console.log(`  selected count : ${selected.length}`);
  console.log(`  out            : ${outPathRel}`);
  console.log("------------------------------------------------------------");
  console.log(sample.map((s) => `  - ${s}`).join("\n") || "  (none)");
  if (selected.length > sample.length) console.log(`  ... (${selected.length - sample.length} more)`);
  console.log("============================================================");
}

try {
  main();
} catch (err) {
  console.error(`[SHARD-SELECT] ERROR: ${err?.stack || err}`);
  process.exit(1);
}
