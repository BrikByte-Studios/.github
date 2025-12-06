#!/usr/bin/env bash
#
# BrikPipe Integration Test Runner
# --------------------------------
# Orchestrates containerized integration tests by:
#   1. Optionally switching into the service workdir (e.g. node-api-example/).
#   2. Waiting for DB (TCP) and app (HTTP) readiness with retries.
#   3. Running language-specific or custom integration test commands.
#   4. Exiting deterministically with a non-zero exit code on failure.
#
# Environment variables (set by the CI workflow):
#   APP_BASE_URL        : Base URL for the app, e.g. http://app:3000
#   APP_HEALTH_URL      : Health URL, e.g. http://app:3000/health
#   DB_HOST             : Database hostname (e.g. db)
#   DB_PORT             : Database port (e.g. 5432)
#   HEALTHCHECK_TIMEOUT : Max seconds to wait for DB/app readiness (default: 60)
#   TEST_LANGUAGE       : node | python | java | go | dotnet (for default commands)
#   TEST_COMMAND        : Optional explicit test command; overrides defaults.
#   SERVICE_WORKDIR     : Optional relative path to the service (e.g. node-api-example).
#                         If set and exists, the runner will cd into it before tests.
#
# This script is intended to be:
#   - Shellcheck-friendly.
#   - Clear in CI logs.
#   - Reusable across Node, Python, Java, Go, and .NET services.
#

set -euo pipefail

# ------------------------
# Logging helper
# ------------------------

log() {
  # log LEVEL MESSAGE...
  local level="$1"
  shift
  printf '[%s] %s\n' "${level}" "$*"
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

  # Keep probing until nc can open a TCP connection or timeout is hit.
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
  local elapsed=0

  log INFO "Waiting for app readiness at ${url} (timeout: ${timeout}s)..."

  # Keep probing until curl returns 2xx or timeout is hit.
  while ! curl -fsS "${url}" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))

    if [ "${elapsed}" -ge "${timeout}" ]; then
      log ERROR "App did not become ready within ${timeout}s."
      return 1
    fi

    log INFO "App not ready yet... (${elapsed}s elapsed)"
  done

  log INFO "App is ready after ${elapsed}s."
}

# ------------------------
# Node.js integration tests
# ------------------------

run_node_tests() {
  # If TEST_COMMAND is set, honour it as-is.
  if [ -n "${TEST_COMMAND:-}" ]; then
    log INFO "Running Node integration tests via TEST_COMMAND: ${TEST_COMMAND}"
    # Use `sh -c` for compatibility with complex commands.
    sh -c "${TEST_COMMAND}"
    return
  fi

  if [ ! -f package.json ]; then
    log ERROR "package.json not found; cannot run Node tests."
    return 1
  fi

  # Prefer a dedicated "test:integration" script if available.
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

  # Ensure current directory (SERVICE_WORKDIR) is on PYTHONPATH so
  # imports like `from main import app` always work.
  log INFO "Exporting PYTHONPATH to include current directory: $(pwd)"
  export PYTHONPATH="$(pwd):${PYTHONPATH:-}"

  # First attempt: use the "integration" mark convention.
  log INFO "Running Python integration tests via 'pytest -m integration'"

  # Temporarily disable -e so we can inspect pytest's exit code.
  set +e
  pytest -m "integration"
  status=$?
  set -e

  # Exit code 5 = no tests collected / all deselected.
  if [ "${status}" -eq 5 ]; then
    log WARN "No tests collected for '-m integration'; falling back to 'pytest'."
    pytest
    return
  fi

  # Propagate pytest status (0 = success, others = real failures).
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

  # Helper: does the integration-tests profile exist?
  has_integration_profile="false"
  if [ -f pom.xml ] && grep -q "<id>integration-tests</id>" pom.xml; then
    has_integration_profile="true"
  fi

  # Prefer Maven wrapper if present.
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

    # Optionally detect integrationTest task; otherwise fall back to test.
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

  # Disable cgo by default so we don't need a full C toolchain (stdlib headers).
  # You can override this per-workflow by setting CGO_ENABLED=1 in env if needed.
  export CGO_ENABLED="${CGO_ENABLED:-0}"
  log INFO "Running Go tests with CGO_ENABLED=${CGO_ENABLED}"

  # Convention: integration tests live behind the `integration` build tag
  # and use function names containing "Integration".
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

  # Convention: integration test project under tests/*IntegrationTests*.csproj
  # Adjust to your agreed naming pattern.
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

main() {
  log INFO "Starting BrikPipe integration test runner..."
  log INFO "Configuration:"
  log INFO "  APP_BASE_URL        : ${APP_BASE_URL:-<not-set>}"
  log INFO "  APP_HEALTH_URL      : ${APP_HEALTH_URL:-<not-set>}"
  log INFO "  DB_HOST             : ${DB_HOST:-<not-set>}"
  log INFO "  DB_PORT             : ${DB_PORT:-<not-set>}"
  log INFO "  HEALTHCHECK_TIMEOUT : ${HEALTHCHECK_TIMEOUT:-60}"
  log INFO "  TEST_LANGUAGE       : ${TEST_LANGUAGE:-<not-set>}"
  log INFO "  TEST_COMMAND        : ${TEST_COMMAND:-<none>} (if set, overrides language defaults)"
  log INFO "  SERVICE_WORKDIR     : ${SERVICE_WORKDIR:-<not-set>}"

  # If SERVICE_WORKDIR is set (e.g., node-api-example) and exists,
  # switch into it so package.json, mvnw, etc. are in the current dir.
  if [ -n "${SERVICE_WORKDIR:-}" ] && [ -d "${SERVICE_WORKDIR}" ]; then
    log INFO "Changing working directory to SERVICE_WORKDIR='${SERVICE_WORKDIR}'"
    cd "${SERVICE_WORKDIR}"
  else
    log INFO "SERVICE_WORKDIR not set or directory missing; staying in $(pwd)"
  fi

  # 1) Explicit health checks to avoid startup race conditions.
  wait_for_db
  wait_for_app

  # 2) Dispatch to appropriate test runner.
  case "${TEST_LANGUAGE:-}" in
    node)
      run_node_tests
      ;;
    python)
      run_python_tests
      ;;
    java)
      run_java_tests
      ;;
    go)
      run_go_tests
      ;;
    dotnet)
      run_dotnet_tests
      ;;
    "")
      # No language hint; fall back to explicit TEST_COMMAND, if provided.
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

  log INFO "Integration tests completed successfully."
}

main "$@"
