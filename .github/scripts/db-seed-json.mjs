#!/usr/bin/env node
/**
 * -----------------
 * Simple JSON seed loader for Postgres.
 *
 * Usage:
 *   node .github/scripts/db-seed-json.mjs \
 *     --engine postgres \
 *     --host localhost \
 *     --port 5432 \
 *     --user testuser \
 *     --password testpass \
 *     --database testdb \
 *     --file tests/integration/fixtures/db/20_test_cases.seed.json
 *
 * JSON format:
 * {
 *   "table": "users",
 *   "rows": [
 *     { "id": 1, "email": "test@example.com" }
 *   ]
 * }
 *
 * Inserts are idempotent via ON CONFLICT DO NOTHING (Postgres).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

/**
 * Parses CLI arguments into a simple key/value object.
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key || !val) break;
    if (key.startsWith("--")) {
      args[key.slice(2)] = val;
    }
  }
  return args;
}

/**
 * Logs a message with a consistent prefix.
 */
function log(level, msg) {
  console.log(`[DB-SEED-JSON][${level}] ${msg}`);
}

async function main() {
  const args = parseArgs(process.argv);

  const engine = args.engine || "postgres";
  const host = args.host || "localhost";
  const port = Number(args.port || 5432);
  const user = args.user || "testuser";
  const password = args.password || "testpass";
  const database = args.database || "testdb";
  const file = args.file;

  if (!file) {
    throw new Error("Missing required --file argument for JSON seed.");
  }

  if (engine !== "postgres") {
    throw new Error(`Only 'postgres' is supported for JSON seeds (got: ${engine}).`);
  }

  const fullPath = path.resolve(file);
  log("INFO", `Loading JSON seed from ${fullPath}`);

  const raw = fs.readFileSync(fullPath, "utf8");
  const payload = JSON.parse(raw);

  const table = payload.table;
  const rows = payload.rows;

  if (!table || !Array.isArray(rows)) {
    throw new Error("Seed JSON must contain 'table' (string) and 'rows' (array).");
  }

  if (rows.length === 0) {
    log("INFO", "No rows to insert; skipping.");
    return;
  }

  const client = new Client({
    host,
    port,
    user,
    password,
    database,
  });

  await client.connect();
  log("INFO", `Connected to Postgres at ${host}:${port}/${database}`);

  // Build insert query with ON CONFLICT DO NOTHING for idempotency.
  const columns = Object.keys(rows[0]);

  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const valuePlaceholders = rows
    .map(
      (_, rowIndex) =>
        `(${columns.map((__, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(", ")})`
    )
    .join(", ");

  const values = [];
  for (const row of rows) {
    for (const col of columns) {
      values.push(row[col]);
    }
  }

  // For simplicity, if "id" exists, use ON CONFLICT (id) DO NOTHING.
  // Otherwise, just plain INSERT.
  let query = `INSERT INTO "${table}" (${columnList}) VALUES ${valuePlaceholders}`;

  if (columns.includes("id")) {
    query += ' ON CONFLICT ("id") DO NOTHING';
  }

  log("INFO", `Executing INSERT into "${table}" for ${rows.length} rows`);
  await client.query(query, values);
  await client.end();
  log("INFO", "JSON seed applied successfully.");
}

// Top-level invocation
main().catch((err) => {
  log("ERROR", err.message || String(err));
  process.exit(1);
});
