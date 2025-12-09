#!/usr/bin/env bash
#
# File: .github/scripts/wait-for-health.sh
#
# BrikPipe — Shared Health Check Helper
# -------------------------------------
# Purpose:
#   Provide a reusable, explicit health-check script with clear logging
#   to avoid random flakiness caused by arbitrary sleeps.
#
#   This script can be used:
#     - By the integration-test-runner container.
#     - Directly from service workflows in brik-pipe-examples and
#       other BrikByte repos.
#
# Environment variables:
#   TARGET_URL        : Full HTTP URL to probe (e.g., http://app:3000/health).
#   TIMEOUT_SECONDS   : Max seconds to wait before failing (default: 60).
#   SLEEP_SECONDS     : Delay between attempts (default: 2).
#
# Exit codes:
#   0  - Target became healthy within timeout.
#   1  - Timed out waiting for healthy response.
#

set -euo pipefail

log() {
  # log LEVEL MESSAGE...
  local level="$1"
  shift
  printf '[HEALTH-%s] %s\n' "${level}" "$*"
}

TARGET_URL="${TARGET_URL:-}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

if [[ -z "${TARGET_URL}" ]]; then
  log "ERROR" "TARGET_URL is not set; nothing to probe."
  exit 1
fi

log "INFO" "Starting health check for: ${TARGET_URL}"
log "INFO" "Timeout: ${TIMEOUT_SECONDS}s | Interval: ${SLEEP_SECONDS}s"

elapsed=0

# Keep probing until curl returns a successful (2xx) response or timeout.
while ! curl -fsS "${TARGET_URL}" >/dev/null 2>&1; do
  sleep "${SLEEP_SECONDS}"
  elapsed=$((elapsed + SLEEP_SECONDS))

  if (( elapsed >= TIMEOUT_SECONDS )); then
    log "ERROR" "Health check FAILED after ${elapsed}s (URL: ${TARGET_URL})."
    exit 1
  fi

  log "INFO" "Target not ready yet... (${elapsed}s elapsed)"
done

log "INFO" "Health check PASSED after ${elapsed}s (URL: ${TARGET_URL})."
exit 0
