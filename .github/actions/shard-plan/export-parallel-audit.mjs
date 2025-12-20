#!/usr/bin/env node
/**
 * export-parallel-audit.mjs
 * -----------------------------------------------------------------------------
 * PIPE-PARALLEL-SHARD-DYNAMIC-003
 *
 * Copies shard-map.json + metadata into .audit/<YYYY-MM-DD>/parallel/
 * for governance traceability.
 *
 * This script is intentionally file-system only and deterministic.
 */

import fs from "fs";
import path from "path";

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

const shardMapPath = arg("shard-map", "out/shard-map.json");
const outRoot = arg("audit-root", ".audit");
const date = arg("date", new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
const plannerMetaPath = arg("meta", "out/shard-planner-metadata.json");

if (!fs.existsSync(shardMapPath)) {
  console.error(`export-parallel-audit: shard map not found: ${shardMapPath}`);
  process.exit(2);
}

const destDir = path.join(outRoot, date, "parallel");
ensureDir(destDir);

const destShardMap = path.join(destDir, "shard-map.json");
fs.copyFileSync(shardMapPath, destShardMap);

// Optional metadata copy if present
if (fs.existsSync(plannerMetaPath)) {
  fs.copyFileSync(plannerMetaPath, path.join(destDir, "shard-planner-metadata.json"));
}

console.log(`✅ exported shard-map to ${destShardMap}`);
