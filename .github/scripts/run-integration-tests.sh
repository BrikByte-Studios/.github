#!/usr/bin/env bash
#
# BrikPipe Integration Test Runner (Service×Scenario matrix aware)
# ---------------------------------------------------------------
# Adds deterministic, governed integration sharding:
#   - Matrix-plan emits: matrix.items_csv (service::scenario pairs per shard)
#   - Workflow sets: INTEG_ITEMS_CSV="${{ matrix.items_csv }}"
#   - Runner executes each pair sequentially (lower DB contention)
#
# Env additions:
#   INTEG_ITEMS_CSV : CSV list of "service::scenario" pairs for this shard.
#                     Example: "users::happy_path,payments::timeout"
#   ITEMS_CSV       : Fallback alias (if you prefer to pass it that way)
#
# Templated TEST_COMMAND support (recommended for sharded integration):
#   TEST_COMMAND="npm run test:integration -- --service {{service}} --scenario {{scenario}}"
#   TEST_COMMAND="pytest -m integration -k '{{service}} and {{scenario}}'"
#
# Or use env vars inside your test harness:
#   INTEG_SERVICE / INTEG_SCENARIO / INTEG_ITEM
#
# Existing behavior remains when no items CSV is provided.

set -euo pipefail

# ------------------------
# Logging helper
# ------------------------

log() {
  local level="$1"
  shift
  printf '[%s] %s\n' "${level}" "$*"
}

# ------------------------
# Integration item parsing
# ------------------------

# Returns 0 if looks like "svc::scenario", else 1
is_pair() {
  local s="$1"
  [[ "$s" == *"::"* ]] || return 1
  local svc="${s%%::*}"
  local sc="${s#*::}"
  [[ -n "${svc// /}" && -n "${sc// /}" ]]
}

# Normalize a CSV list into newline-delimited items (trimmed), stable order.
# Determinism matters even if matrix-plan already sorted.
csv_to_lines_sorted() {
  local csv="${1:-}"
  if [ -z "${csv// /}" ]; then
    return 0
  fi

  # split by comma, trim, drop empties
  printf "%s" "$csv" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
    | sed '/^$/d' \
    | LC_ALL=C sort
}

# Expand a TEST_COMMAND template:
#   - replaces {{service}} and {{scenario}} if present
expand_test_command() {
  local template="$1"
  local service="$2"
  local scenario="$3"

  # safe-ish placeholder substitution
  local cmd="${template//\{\{service\}\}/${service}}"
  cmd="${cmd//\{\{scenario\}\}/${scenario}}"
  printf "%s" "$cmd"
}

# Runs an item-specific command:
# - exports INTEG_SERVICE / INTEG_SCENARIO / INTEG_ITEM for the test process
# - if TEST_COMMAND is set, use it (templated or env-driven)
# - if TEST_COMMAND is empty, we fall back to language defaults ONCE (not per item),
#   because most defaults can’t reliably filter per service/scenario without conventions.
run_one_item() {
  local service="$1"
  local scenario="$2"

  export INTEG_SERVICE="$service"
  export INTEG_SCENARIO="$scenario"
  export INTEG_ITEM="${service}::${scenario}"

  log INFO "▶ Running integration item: ${INTEG_ITEM}"

  if [ -n "${TEST_COMMAND:-}" ]; then
    local cmd
    cmd="$(expand_test_command "${TEST_COMMAND}" "${service}" "${scenario}")"

    # ---- Java safety: normalize "./mvn" to something real -------------------
    # People frequently write "./mvn" but repo actually uses mvnw or mvn.
    if [[ "${cmd}" =~ ^\./mvn(\ |$) ]]; then
      if [ -f "./mvnw" ]; then
        log WARN "TEST_COMMAND uses './mvn' but mvnw exists. Rewriting to './mvnw'..."
        cmd="${cmd/\.\/mvn/\.\/mvnw}"
        chmod +x ./mvnw || true
      elif command -v mvn >/dev/null 2>&1; then
        log WARN "TEST_COMMAND uses './mvn' but mvn is available. Rewriting to 'mvn'..."
        cmd="${cmd/\.\/mvn/mvn}"
      else
        log ERROR "TEST_COMMAND uses './mvn' but neither ./mvnw nor mvn is available in the runner container."
        log ERROR "Fix: use './mvnw ...' (preferred) or ensure Maven is installed in integration-test-runner image."
        return 127
      fi
    fi
    # ------------------------------------------------------------------------
    
    log INFO "   TEST_COMMAND: ${cmd}"
    sh -c "${cmd}"
    return
  fi

  # No TEST_COMMAND: we can’t safely “filter” by pair for generic repos.
  # Do not rerun full suites per item (too expensive + more contention).
  log WARN "No TEST_COMMAND set; cannot run per service::scenario item deterministically."
  log WARN "Falling back to a single language-default integration run (ignoring item list)."
  return 2
}

# Execute items for this shard (sequentially).
# Returns:
#   0 = success
#   1 = real failure
#   2 = “no per-item command available” (signals caller to run default once)
run_items_for_shard() {
  local items_csv="${INTEG_ITEMS_CSV:-${ITEMS_CSV:-}}"

  if [ -z "${items_csv// /}" ]; then
    return 3  # no items provided
  fi

  log INFO "Shard item plan detected (INTEG_ITEMS_CSV/ITEMS_CSV)."
  log INFO "Raw items_csv: ${items_csv}"

  local any=0
  local needs_default_once=0

  while IFS= read -r item; do
    any=1
    if ! is_pair "${item}"; then
      log WARN "Skipping invalid item (expected service::scenario): '${item}'"
      continue
    fi

    local service="${item%%::*}"
    local scenario="${item#*::}"

    set +e
    run_one_item "${service}" "${scenario}"
    rc=$?
    set -e

    if [ $rc -eq 0 ]; then
      log INFO "✔ Item passed: ${item}"
      continue
    fi

    if [ $rc -eq 2 ]; then
      needs_default_once=1
      # keep scanning items to surface invalid ones, but don’t fail yet
      continue
    fi

    log ERROR "✖ Item failed: ${item} (exit=${rc})"
    return 1
  done < <(csv_to_lines_sorted "${items_csv}")

  if [ "${any}" -eq 0 ]; then
    log WARN "Items CSV was provided but empty after normalization."
    return 3
  fi

  if [ "${needs_default_once}" -eq 1 ]; then
    return 2
  fi

  return 0
}

# ------------------------
# DB readiness check
# ------------------------

wait_for_db() {
  local host="${DB_HOST:-db}"
  local port="${DB_PORT:-5432}"
  local timeout="${HEALTHCHECK_TIMEOUT:-60}"
  local elapsed=0

  log INFO "Waiting for DB at ${host}:${port} (timeout: ${timeout}s)..."

  while ! nc -z "${host}" "${port}" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))

    if [ "${elapsed}" -ge "${timeout}" ]; then
      log ERROR "DB did not become ready within ${timeout}s."
      return 1
    fi

    log INFO "DB not ready yet... (${elapsed}s elapsed)"
  done

  log INFO "DB is ready after ${elapsed}s."
}

# ------------------------
# App readiness check
# ------------------------

wait_for_app() {
  local url="${APP_HEALTH_URL:-http://app:3000/health}"
  local timeout="${HEALTHCHECK_TIMEOUT:-60}"
  local interval="2"

  log INFO "Delegating app health check to wait-for-health.sh"
  log INFO "  TARGET_URL      : ${url}"
  log INFO "  TIMEOUT_SECONDS : ${timeout}"
  log INFO "  SLEEP_SECONDS   : ${interval}"

  TARGET_URL="${url}" \
  TIMEOUT_SECONDS="${timeout}" \
  SLEEP_SECONDS="${interval}" \
    /usr/local/bin/wait-for-health.sh
}

# ------------------------
# Node.js integration tests
# ------------------------

run_node_tests() {
  if [ -n "${TEST_COMMAND:-}" ]; then
    log INFO "Running Node integration tests via TEST_COMMAND: ${TEST_COMMAND}"
    sh -c "${TEST_COMMAND}"
    return
  fi

  if [ ! -f package.json ]; then
    log ERROR "package.json not found; cannot run Node tests."
    return 1
  fi

  if npm run | grep -q "test:integration"; then
    log INFO "Running Node integration tests via 'npm run test:integration'"
    npm run test:integration
  else
    log INFO "Running Node tests via 'npm test'"
    npm test
  fi
}

# ------------------------
# Python integration tests
# ------------------------

run_python_tests() {
  if [ -n "${TEST_COMMAND:-}" ]; then
    log INFO "Running Python integration tests via TEST_COMMAND: ${TEST_COMMAND}"
    sh -c "${TEST_COMMAND}"
    return
  fi

  if ! command -v pytest >/dev/null 2>&1; then
    log ERROR "pytest not installed; cannot run Python integration tests."
    return 1
  fi

  log INFO "Exporting PYTHONPATH to include current directory: $(pwd)"
  export PYTHONPATH="$(pwd):${PYTHONPATH:-}"

  log INFO "Running Python integration tests via 'pytest -m integration'"

  set +e
  pytest -m "integration"
  status=$?
  set -e

  if [ "${status}" -eq 5 ]; then
    log WARN "No tests collected for '-m integration'; falling back to 'pytest'."
    pytest
    return
  fi

  return "${status}"
}

# ------------------------
# Java integration tests
# ------------------------

run_java_tests() {
  if [ -n "${TEST_COMMAND:-}" ]; then
    log INFO "Running Java integration tests via TEST_COMMAND: ${TEST_COMMAND}"
    sh -c "${TEST_COMMAND}"
    return
  fi

  has_integration_profile="false"
  if [ -f pom.xml ] && grep -q "<id>integration-tests</id>" pom.xml; then
    has_integration_profile="true"
  fi

  if [ -f mvnw ]; then
    chmod +x mvnw
    if [ "${has_integration_profile}" = "true" ]; then
      log INFO "Running Java integration tests via './mvnw -B verify -Pintegration-tests'"
      ./mvnw -B verify -Pintegration-tests
    else
      log INFO "No 'integration-tests' profile found; running './mvnw -B test'"
      ./mvnw -B test
    fi
  elif command -v mvn >/dev/null 2>&1; then
    if [ "${has_integration_profile}" = "true" ]; then
      log INFO "Running Java integration tests via 'mvn -B verify -Pintegration-tests'"
      mvn -B verify -Pintegration-tests
    else
      log INFO "No 'integration-tests' profile found; running 'mvn -B test'"
      mvn -B test
    fi
  elif [ -f gradlew ]; then
    chmod +x gradlew
    if grep -q "integrationTest" build.gradle* 2>/dev/null; then
      log INFO "Running Java integration tests via './gradlew integrationTest'"
      ./gradlew integrationTest
    else
      log INFO "No 'integrationTest' task detected; running './gradlew test'"
      ./gradlew test
    fi
  else
    log ERROR "No Maven/Gradle wrapper or mvn/gradle found; cannot run Java tests."
    return 1
  fi
}

# ------------------------
# Go integration tests
# ------------------------

run_go_tests() {
  if [ -n "${TEST_COMMAND:-}" ]; then
    log INFO "Running Go integration tests via TEST_COMMAND: ${TEST_COMMAND}"
    sh -c "${TEST_COMMAND}"
    return
  fi

  if ! command -v go >/dev/null 2>&1; then
    log ERROR "go not installed; cannot run Go integration tests."
    return 1
  fi

  export CGO_ENABLED="${CGO_ENABLED:-0}"
  log INFO "Running Go tests with CGO_ENABLED=${CGO_ENABLED}"

  log INFO "Running Go integration tests via 'go test -tags=integration ./... -run Integration'"
  go test -tags=integration ./... -run "Integration"
}

# ------------------------
# .NET integration tests
# ------------------------

run_dotnet_tests() {
  if [ -n "${TEST_COMMAND:-}" ]; then
    log INFO "Running .NET integration tests via TEST_COMMAND: ${TEST_COMMAND}"
    sh -c "${TEST_COMMAND}"
    return
  fi

  if ! command -v dotnet >/dev/null 2>&1; then
    log ERROR "dotnet not installed; cannot run .NET integration tests."
    return 1
  fi

  local default_project
  default_project="$(find tests -maxdepth 2 -name '*IntegrationTests*.csproj' | head -n 1 || true)"

  if [ -n "${default_project}" ]; then
    log INFO "Running .NET integration tests via 'dotnet test ${default_project}'"
    dotnet test "${default_project}"
  else
    log INFO "No default integration test project found; running 'dotnet test' in current directory"
    dotnet test
  fi
}

# ------------------------
# Main flow
# ------------------------

run_language_default_once() {
  case "${TEST_LANGUAGE:-}" in
    node)   run_node_tests ;;
    python) run_python_tests ;;
    java)   run_java_tests ;;
    go)     run_go_tests ;;
    dotnet) run_dotnet_tests ;;
    "")
      if [ -n "${TEST_COMMAND:-}" ]; then
        log INFO "TEST_LANGUAGE not set; running TEST_COMMAND only."
        sh -c "${TEST_COMMAND}"
      else
        log ERROR "Neither TEST_LANGUAGE nor TEST_COMMAND set; nothing to run."
        return 1
      fi
      ;;
    *)
      if [ -n "${TEST_COMMAND:-}" ]; then
        log WARN "Unsupported TEST_LANGUAGE='${TEST_LANGUAGE}', but TEST_COMMAND is set. Running custom command."
        sh -c "${TEST_COMMAND}"
      else
        log ERROR "Unsupported TEST_LANGUAGE='${TEST_LANGUAGE}' and TEST_COMMAND is empty."
        return 1
      fi
      ;;
  esac
}

main() {
  log INFO "Starting BrikPipe integration test runner..."
  log INFO "Configuration:"
  log INFO "  APP_BASE_URL        : ${APP_BASE_URL:-<not-set>}"
  log INFO "  APP_HEALTH_URL      : ${APP_HEALTH_URL:-<not-set>}"
  log INFO "  DB_HOST             : ${DB_HOST:-<not-set>}"
  log INFO "  DB_PORT             : ${DB_PORT:-<not-set>}"
  log INFO "  HEALTHCHECK_TIMEOUT : ${HEALTHCHECK_TIMEOUT:-60}"
  log INFO "  TEST_LANGUAGE       : ${TEST_LANGUAGE:-<not-set>}"
  log INFO "  TEST_COMMAND        : ${TEST_COMMAND:-<none>}"
  log INFO "  SERVICE_WORKDIR     : ${SERVICE_WORKDIR:-<not-set>}"
  log INFO "  INTEG_ITEMS_CSV     : ${INTEG_ITEMS_CSV:-<none>}"
  log INFO "  ITEMS_CSV           : ${ITEMS_CSV:-<none>}"

  if [ -n "${SERVICE_WORKDIR:-}" ] && [ -d "${SERVICE_WORKDIR}" ]; then
    log INFO "Changing working directory to SERVICE_WORKDIR='${SERVICE_WORKDIR}'"
    cd "${SERVICE_WORKDIR}"
  else
    log INFO "SERVICE_WORKDIR not set or directory missing; staying in $(pwd)"
  fi

  wait_for_db
  wait_for_app

  # 2) If we have a service×scenario plan, run it.
  set +e
  run_items_for_shard
  rc_items=$?
  set -e

  case "${rc_items}" in
    0)
      log INFO "All planned service×scenario items passed for this shard."
      ;;
    1)
      log ERROR "At least one planned item failed."
      return 1
      ;;
    2)
      log WARN "Item plan present, but per-item execution not possible without TEST_COMMAND."
      log WARN "Running language-default integration suite once (best-effort)."
      run_language_default_once
      ;;
    3)
      # No items plan -> original behavior
      run_language_default_once
      ;;
    *)
      log ERROR "Unexpected item-plan return code: ${rc_items}"
      return 1
      ;;
  esac

  log INFO "Integration tests completed successfully."
}

main "$@"
