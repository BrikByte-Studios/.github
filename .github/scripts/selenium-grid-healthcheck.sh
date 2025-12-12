#!/usr/bin/env bash
# ==============================================================================
# Selenium Grid Health Check — BrikByteOS
# ==============================================================================
#
# PURPOSE
# -------
# Wait until Selenium Grid is ready and required browser nodes are registered.
#
# WHAT IT CHECKS
# --------------
# 1) Hub status endpoint reachable (HTTP 200)
# 2) Hub reports "ready": true
# 3) Node registration includes required browsers (chrome + firefox)
# 4) Optional: edge node check if ENABLE_EDGE=true
#
# INPUTS (env vars)
# -----------------
# SELENIUM_REMOTE_URL  (default: http://localhost:4444/wd/hub)
# TIMEOUT_SECONDS      (default: 120)
# SLEEP_SECONDS        (default: 5)
# ENABLE_EDGE          (default: false)
#
# OUTPUT
# ------
# Returns 0 if healthy; exits 1 on timeout/failure.
#
# SECURITY
# --------
# No secrets should be passed to this script; it prints only diagnostics.
# ==============================================================================

set -euo pipefail

SELENIUM_REMOTE_URL="${SELENIUM_REMOTE_URL:-http://localhost:4444/wd/hub}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"
ENABLE_EDGE="${ENABLE_EDGE:-false}"

STATUS_URL="${SELENIUM_REMOTE_URL%/}/status"

echo "[SELENIUM] Healthcheck starting..."
echo "[SELENIUM] STATUS_URL=${STATUS_URL}"
echo "[SELENIUM] TIMEOUT_SECONDS=${TIMEOUT_SECONDS}, SLEEP_SECONDS=${SLEEP_SECONDS}, ENABLE_EDGE=${ENABLE_EDGE}"

elapsed=0

# Helper: fetch status JSON safely.
fetch_status() {
  curl -fsS "${STATUS_URL}" 2>/dev/null || return 1
}

# Helper: check if JSON includes a substring. (We avoid jq dependency for portability.)
has_substring() {
  local haystack="$1"
  local needle="$2"
  echo "${haystack}" | grep -q "${needle}"
}

while true; do
  if status_json="$(fetch_status)"; then
    # Check hub ready
    if has_substring "${status_json}" '"ready":true'; then
      # Check node stereotypes (very light heuristic without jq)
      # Selenium status commonly includes node / slot info; we search for browserName patterns.
      chrome_ok=false
      firefox_ok=false
      edge_ok=false

      if has_substring "${status_json}" '"browserName":"chrome"'; then chrome_ok=true; fi
      if has_substring "${status_json}" '"browserName":"firefox"'; then firefox_ok=true; fi
      if has_substring "${status_json}" '"browserName":"MicrosoftEdge"'; then edge_ok=true; fi
      if has_substring "${status_json}" '"browserName":"edge"'; then edge_ok=true; fi

      if [ "${chrome_ok}" = "true" ] && [ "${firefox_ok}" = "true" ]; then
        if [ "${ENABLE_EDGE}" = "true" ] && [ "${edge_ok}" != "true" ]; then
          echo "[SELENIUM] Hub ready, but Edge not registered yet..."
        else
          echo "[SELENIUM] ✅ Grid ready. Nodes registered: chrome=${chrome_ok}, firefox=${firefox_ok}, edge=${edge_ok}"
          exit 0
        fi
      else
        echo "[SELENIUM] Hub ready, waiting for nodes... chrome=${chrome_ok}, firefox=${firefox_ok}, edge=${edge_ok}"
      fi
    else
      echo "[SELENIUM] Hub reachable but not ready yet..."
    fi
  else
    echo "[SELENIUM] Hub not reachable yet..."
  fi

  sleep "${SLEEP_SECONDS}"
  elapsed=$((elapsed + SLEEP_SECONDS))

  if [ "${elapsed}" -ge "${TIMEOUT_SECONDS}" ]; then
    echo "[SELENIUM] ❌ Timeout after ${TIMEOUT_SECONDS}s waiting for Grid readiness."
    echo "[SELENIUM] Tip: check docker compose logs for selenium-hub / nodes."
    exit 1
  fi
done
