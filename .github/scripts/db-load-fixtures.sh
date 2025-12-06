#!/usr/bin/env bash
# -------------------
# Standardized loader for DB fixtures used by BrikPipe integration tests.
#
# Supports:
#   - PostgreSQL (primary)
#   - JSON seed files via Node helper (db-seed-json.mjs)
#
# Environment variables (default-safe):
#   DB_ENGINE        : "postgres" | "mysql" (mysql TBD)
#   DB_HOST          : default "localhost"
#   DB_PORT          : default 5432 for postgres
#   DB_USER          : default "testuser"
#   DB_PASSWORD      : default "testpass"
#   DB_NAME          : default "testdb"
#   FIXTURE_DIR      : default "tests/integration/fixtures/db"
#
#   ENABLE_DB_FIXTURES : "true" | "false" (default: "true")
#   DB_WAIT_TIMEOUT    : seconds to wait for DB readiness (default: 60)
#
# Behavior:
#   - If ENABLE_DB_FIXTURES=false, script no-ops.
#   - Waits for DB readiness (Postgres: SELECT 1) before applying fixtures.
#   - Finds *.sql and *.seed.json in FIXTURE_DIR, sorted lexicographically.
#   - Applies SQL files in order using psql (Postgres).
#   - Applies JSON seed files via db-seed-json.mjs (Node helper), but
#     **skips gracefully** if Node or helper is not available.
#

set -euo pipefail

log() {
  # Small logging helper with consistent prefix.
  local level="$1"
  shift
  printf '[DB-FIXTURES][%s] %s\n' "${level}" "$*"
}

# ------------------------------
# 1. Read configuration
# ------------------------------
DB_ENGINE="${DB_ENGINE:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-testuser}"
DB_PASSWORD="${DB_PASSWORD:-testpass}"
DB_NAME="${DB_NAME:-testdb}"
FIXTURE_DIR="${FIXTURE_DIR:-tests/integration/fixtures/db}"
ENABLE_DB_FIXTURES="${ENABLE_DB_FIXTURES:-true}"
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"

if [ "${ENABLE_DB_FIXTURES}" != "true" ]; then
  log INFO "ENABLE_DB_FIXTURES=${ENABLE_DB_FIXTURES}; skipping fixture load."
  exit 0
fi

# ------------------------------
# 2. Validate fixture directory
# ------------------------------
if [ ! -d "${FIXTURE_DIR}" ]; then
  log WARN "Fixture directory not found: ${FIXTURE_DIR}. Nothing to load."
  exit 0
fi

log INFO "Loading DB fixtures from '${FIXTURE_DIR}' for engine '${DB_ENGINE}'"
log INFO "DB connection: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# ------------------------------
# 3. Wait for DB readiness
# ------------------------------

wait_for_postgres() {
  local elapsed=0

  log INFO "Waiting for Postgres at ${DB_HOST}:${DB_PORT} (timeout: ${DB_WAIT_TIMEOUT}s)..."

  export PGPASSWORD="${DB_PASSWORD}"

  while ! psql \
      -h "${DB_HOST}" \
      -p "${DB_PORT}" \
      -U "${DB_USER}" \
      -d "${DB_NAME}" \
      -c "SELECT 1;" >/dev/null 2>&1; do

    sleep 2
    elapsed=$((elapsed + 2))

    if [ "${elapsed}" -ge "${DB_WAIT_TIMEOUT}" ]; then
      log ERROR "Postgres did not become ready within ${DB_WAIT_TIMEOUT}s."
      return 1
    fi

    log INFO "DB not ready yet... (${elapsed}s elapsed)"
  done

  log INFO "Postgres is ready after ${elapsed}s."
}

case "${DB_ENGINE}" in
  postgres)
    wait_for_postgres
    ;;
  mysql)
    log WARN "DB_ENGINE='mysql' wait logic not implemented yet; continuing without readiness check."
    ;;
  *)
    log ERROR "Unsupported DB_ENGINE='${DB_ENGINE}' for readiness checks."
    exit 1
    ;;
esac

# ------------------------------
# 4. Discover fixtures
# ------------------------------
mapfile -t SQL_FILES  < <(find "${FIXTURE_DIR}" -maxdepth 1 -type f -name '*.sql'        | sort || true)
mapfile -t JSON_FILES < <(find "${FIXTURE_DIR}" -maxdepth 1 -type f -name '*.seed.json'  | sort || true)

if [ "${#SQL_FILES[@]}" -eq 0 ] && [ "${#JSON_FILES[@]}" -eq 0 ]; then
  log INFO "No .sql or .seed.json fixtures found; nothing to apply."
  exit 0
fi

# ------------------------------
# 5. Engine-specific SQL apply
# ------------------------------

apply_sql_postgres() {
  local sql_file="$1"

  log INFO "Applying SQL fixture (Postgres): ${sql_file}"
  PGPASSWORD="${DB_PASSWORD}" psql \
    -v ON_ERROR_STOP=1 \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -f "${sql_file}"
}

apply_sql_mysql() {
  local sql_file="$1"
  log ERROR "MySQL fixture support not yet implemented. Attempted file: ${sql_file}"
  return 1
}

apply_sql_file() {
  local sql_file="$1"
  case "${DB_ENGINE}" in
    postgres)
      apply_sql_postgres "${sql_file}"
      ;;
    mysql)
      apply_sql_mysql "${sql_file}"
      ;;
    *)
      log ERROR "Unsupported DB_ENGINE='${DB_ENGINE}' for SQL fixtures."
      return 1
      ;;
  esac
}

# ------------------------------
# 6. JSON seeds via Node helper
# ------------------------------

apply_json_seed() {
  local json_file="$1"

  log INFO "Applying JSON seed via db-seed-json.mjs: ${json_file}"

  # If Node is missing, warn and skip instead of failing the pipeline.
  if ! command -v node >/dev/null 2>&1; then
    log WARN "node not found in PATH; skipping JSON seed: ${json_file}"
    return 0
  fi

  # If helper script is missing, warn and skip instead of failing the pipeline.
  if [ ! -f ".github/scripts/db-seed-json.mjs" ]; then
    log WARN "Helper '.github/scripts/db-seed-json.mjs' not found; skipping JSON seed: ${json_file}"
    return 0
  fi

  node ".github/scripts/db-seed-json.mjs" \
    --engine "${DB_ENGINE}" \
    --host "${DB_HOST}" \
    --port "${DB_PORT}" \
    --user "${DB_USER}" \
    --password "${DB_PASSWORD}" \
    --database "${DB_NAME}" \
    --file "${json_file}"
}

# ------------------------------
# 7. Apply fixtures in order
# ------------------------------
log INFO "Found ${#SQL_FILES[@]} SQL fixtures and ${#JSON_FILES[@]} JSON seed fixtures."

for f in "${SQL_FILES[@]}"; do
  [ -n "${f}" ] && apply_sql_file "${f}"
done

for f in "${JSON_FILES[@]}"; do
  [ -n "${f}" ] && apply_json_seed "${f}"
done

log INFO "DB fixture load completed successfully."
