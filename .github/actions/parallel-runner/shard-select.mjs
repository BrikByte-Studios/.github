/**
 * shard-select.mjs
 *
 * Deterministically selects a subset of test files for a shard.
 *
 * Contract:
 * - index is 0-based
 * - total is total shards
 *
 * Algorithm (stable + deterministic):
 * 1) Walk workdir, build relative file list
 * 2) Filter by glob (converted to RegExp)
 * 3) Sort paths
 * 4) Select items where (fileIndex % total) === index
 *
 * Usage (avoid block-comment sequences like ")
 */

import { readdirSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";

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
 * Convert a (minimal) glob pattern to RegExp.
 * Supported:
 *  - **  : match across path segments (including "/")
 *  - *   : match within a segment (no "/")
 *  - ?   : match single char within segment (no "/")
 *  - {a,b,c} : brace alternation (no nesting)
 *
 * Notes:
 *  - glob is matched against POSIX-style "/" paths
 *  - pattern is relative to the workdir root
 */
function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, "/");

  const isRegexSpecial = (ch) => /[\\^$+?.()|[\]{}]/.test(ch);

  function escapeLiteral(ch) {
    return isRegexSpecial(ch) ? `\\${ch}` : ch;
  }

  // Parse {a,b} (non-nested)
  function parseBrace(i) {
    let j = i + 1;
    let buf = "";
    while (j < g.length && g[j] !== "}") {
      buf += g[j];
      j++;
    }
    if (j >= g.length) {
      // no closing brace -> treat "{" literally
      return { re: "\\{", next: i + 1 };
    }

    const parts = buf.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return { re: "", next: j + 1 };

    // Escape each part literally (no glob tokens expanded inside braces in this minimal impl)
    const alts = parts.map((p) => p.split("").map(escapeLiteral).join("")).join("|");
    return { re: `(?:${alts})`, next: j + 1 };
  }

  let re = "^";
  for (let i = 0; i < g.length; ) {
    const ch = g[i];

    if (ch === "{") {
      const { re: braceRe, next } = parseBrace(i);
      re += braceRe;
      i = next;
      continue;
    }

    if (ch === "*") {
      // ** => cross directories
      if (g[i + 1] === "*") {
        i += 2;

        // If followed by a slash, consume it and allow "zero or more directories"
        if (g[i] === "/") {
          i += 1;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
        continue;
      }

      // * => within segment (no slash)
      re += "[^/]*";
      i += 1;
      continue;
    }

    if (ch === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }

    if (ch === "/") {
      re += "/";
      i += 1;
      continue;
    }

    re += escapeLiteral(ch);
    i += 1;
  }

  re += "$";
  return new RegExp(re);
}

function walk(dirAbs) {
  const out = [];
  const entries = readdirSync(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
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

  ensureDir(path.dirname(path.resolve(repoRoot, outPath)));

  if (matched.length === 0) {
    fs.writeFileSync(outPath, "", "utf-8");
    console.log(`[SHARD-SELECT] glob matched 0 files; wrote empty list -> ${outPath}`);
    console.log(`[SHARD-SELECT] debug: workdir=${workdir} glob=${glob} regex=${rx}`);
    process.exit(0);
  }

  const selected = matched.filter((_, i) => i % total === index);

  fs.writeFileSync(outPath, selected.join("\n") + (selected.length ? "\n" : ""), "utf-8");

  const sample = selected.slice(0, 12);
  console.log(`[SHARD-SELECT] workdir: ${workdir}`);
  console.log(`[SHARD-SELECT] glob   : ${glob}`);
  console.log(`[SHARD-SELECT] regex  : ${rx}`);
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
