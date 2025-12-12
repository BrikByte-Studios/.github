#!/usr/bin/env bash
set -euo pipefail

: <<'DOCSTRING'
selenium-grid-healthcheck.sh

Purpose:
  Wait until Selenium Grid is ready AND required browser nodes are registered.

Why:
  Selenium hub can be "up" while nodes are still registering. Starting tests too early
  causes flaky "cannot find node" / "session not created" failures.

Usage:
  ./selenium-grid-healthcheck.sh \
    --remote-url "http://localhost:4444/wd/hub" \
    --timeout-seconds "120" \
    --require-chrome "true" \
    --require-firefox "true" \
    --require-edge "false"

Notes:
  - Does NOT print secrets.
  - Produces concise diagnostics with hub status + node counts.
DOCSTRING

REMOTE_URL=""
TIMEOUT_SECONDS="120"
REQUIRE_CHROME="true"
REQUIRE_FIREFOX="true"
REQUIRE_EDGE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote-url) REMOTE_URL="$2"; shift 2;;
    --timeout-seconds) TIMEOUT_SECONDS="$2"; shift 2;;
    --require-chrome) REQUIRE_CHROME="$2"; shift 2;;
    --require-firefox) REQUIRE_FIREFOX="$2"; shift 2;;
    --require-edge) REQUIRE_EDGE="$2"; shift 2;;
    *)
      echo "[GRID] Unknown arg: $1"
      exit 2
      ;;
  esac
done

if [[ -z "${REMOTE_URL}" ]]; then
  echo "[GRID] ERROR: --remote-url is required"
  exit 2
fi

STATUS_URL="http://localhost:4444/status"

echo "[GRID] Waiting for Selenium Grid..."
echo "[GRID] Hub status URL: ${STATUS_URL}"
echo "[GRID] Remote URL: ${REMOTE_URL}"
echo "[GRID] Timeout: ${TIMEOUT_SECONDS}s"
echo "[GRID] Require chrome=${REQUIRE_CHROME}, firefox=${REQUIRE_FIREFOX}, edge=${REQUIRE_EDGE}"

elapsed=0
sleep_step=2

# Helper: best-effort parse of node counts (no jq required, but jq helps)
get_node_counts() {
  local json
  json="$(curl -fsS "${STATUS_URL}" 2>/dev/null || true)"
  if [[ -z "${json}" ]]; then
    echo "0 0 0"
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    # Selenium Grid 4 status JSON: value.nodes[] array with stereotypes / availability.
    # We'll infer browser presence by matching stereotype "browserName".
    local chrome firefox edge
    chrome="$(echo "${json}" | jq -r '[.value.nodes[]?.stereotypes[]? | select(.browserName=="chrome")] | length' 2>/dev/null || echo "0")"
    firefox="$(echo "${json}" | jq -r '[.value.nodes[]?.stereotypes[]? | select(.browserName=="firefox")] | length' 2>/dev/null || echo "0")"
    edge="$(echo "${json}" | jq -r '[.value.nodes[]?.stereotypes[]? | select(.browserName=="MicrosoftEdge" or .browserName=="edge")] | length' 2>/dev/null || echo "0")"
    echo "${chrome} ${firefox} ${edge}"
  else
    # Fallback: rough grep (less accurate, but enough for basic readiness in CI).
    local chrome firefox edge
    chrome="$(echo "${json}" | grep -o '"browserName":"chrome"' | wc -l | tr -d ' ')"
    firefox="$(echo "${json}" | grep -o '"browserName":"firefox"' | wc -l | tr -d ' ')"
    edge="$(echo "${json}" | grep -Eo '"browserName":"MicrosoftEdge"|"browserName":"edge"' | wc -l | tr -d ' ')"
    echo "${chrome} ${firefox} ${edge}"
  fi
}

# Wait until:
# 1) /status reachable and "ready": true (best effort)
# 2) required nodes registered
while true; do
  if curl -fsS "${STATUS_URL}" >/dev/null 2>&1; then
    read -r chrome_count firefox_count edge_count < <(get_node_counts)

    # Basic requirement checks
    chrome_ok="true"
    firefox_ok="true"
    edge_ok="true"

    if [[ "${REQUIRE_CHROME}" == "true" && "${chrome_count}" -lt 1 ]]; then
      chrome_ok="false"
    fi
    if [[ "${REQUIRE_FIREFOX}" == "true" && "${firefox_count}" -lt 1 ]]; then
      firefox_ok="false"
    fi
    if [[ "${REQUIRE_EDGE}" == "true" && "${edge_count}" -lt 1 ]]; then
      edge_ok="false"
    fi

    echo "[GRID] Status reachable. Nodes: chrome=${chrome_count}, firefox=${firefox_count}, edge=${edge_count}"

    if [[ "${chrome_ok}" == "true" && "${firefox_ok}" == "true" && "${edge_ok}" == "true" ]]; then
      echo "[GRID] Ready ✅"
      exit 0
    fi
  else
    echo "[GRID] Hub not reachable yet..."
  fi

  sleep "${sleep_step}"
  elapsed=$((elapsed + sleep_step))
  if (( elapsed >= TIMEOUT_SECONDS )); then
    echo "[GRID] ERROR: Grid not ready within ${TIMEOUT_SECONDS}s"
    echo "[GRID] Diagnostic: dumping /status (best effort)"
    curl -fsS "${STATUS_URL}" || true
    exit 1
  fi
done
