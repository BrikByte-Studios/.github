#!/usr/bin/env bash
set -euo pipefail

: <<'DOCSTRING'
BrikPipe Flaky Repeat-Run Wrapper
================================

TASK:
  PIPE-FLAKY-RERUN-INTEG-001 — Enable Repeat-Run Mode for Test Stability

PURPOSE:
  Provide an opt-in, suite-level rerun mechanism that:
    - Reruns ONLY after an initial failure
    - Runs exactly N total attempts (N = FLAKY_RERUNS)
    - Captures evidence per attempt (logs + optional artifacts)
    - Produces a machine-readable summary.json
    - Never masks the original failure (attempt #1 failure keeps job failed)

WHY SUITE-LEVEL (v1):
  This wrapper reruns the entire test command consistently across:
    - Unit: pytest, jest, maven surefire
    - E2E: playwright, cypress, selenium runners
  Per-test reruns are a later enhancement (plugins / runner features),
  but we want a universal deterministic substrate NOW.

ENV CONTRACT:
  FLAKY_DETECT=true|false  (default false)
  FLAKY_RERUNS=<int>=1     (default 1, total attempts)
  FLAKY_EXPORT_PATH=<dir>  (default out/flaky)
  FLAKY_LABEL=<string>     (default suite) used for log + summary filenames
  FLAKY_MAX_RERUNS=<int>   (default 5, clamps total attempts)

USAGE:
  flaky-rerun.sh -- <command...>

EXAMPLE:
  FLAKY_DETECT=true FLAKY_RERUNS=3 FLAKY_LABEL=python-unit \
    .github/scripts/flaky-rerun.sh -- make test

OUTPUTS:
  $FLAKY_EXPORT_PATH/
    attempt-1/<label>.attempt.log
    attempt-2/<label>.attempt.log
    ...
    <label>.summary.json

EXIT CODE POLICY (REQ-FLAKY-002):
  - If attempt #1 fails, exit NON-ZERO even if later attempts pass.
  - If attempt #1 passes, exit 0 and skip reruns.

NOTES:
  - This script intentionally avoids jq dependency (v1).
  - Command is executed as argv (not eval) to avoid quoting issues.
DOCSTRING

# -------------------------
# Helpers
# -------------------------

die() { echo "❌ [FLAKY-RERUN] $*" >&2; exit 2; }

now_ms() {
  # portable-ish ms timestamp; if %3N unsupported, fall back to seconds*1000
  if date +%s%3N >/dev/null 2>&1; then
    date +%s%3N
  else
    echo "$(( $(date +%s) * 1000 ))"
  fi
}

json_escape() {
  # Minimal JSON string escaping (quotes, backslashes, newlines, tabs).
  # Avoids jq dependency for v1.
  local s="${1}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  echo -n "${s}"
}

# -------------------------
# Inputs
# -------------------------

# Require delimiter to avoid ambiguity and allow passing commands with flags
[[ "${1:-}" == "--" ]] || die "Usage: $0 -- <command...>"
shift

[[ "$#" -ge 1 ]] || die "No command provided. Usage: $0 -- <command...>"

# Command is passed as argv (safe), not as a single string (avoids quote bugs).
CMD=( "$@" )

FLAKY_DETECT="${FLAKY_DETECT:-false}"
FLAKY_RERUNS="${FLAKY_RERUNS:-1}"
FLAKY_EXPORT_PATH="${FLAKY_EXPORT_PATH:-out/flaky}"
FLAKY_LABEL="${FLAKY_LABEL:-suite}"
FLAKY_MAX_RERUNS="${FLAKY_MAX_RERUNS:-5}"

# Normalize booleans
case "${FLAKY_DETECT}" in
  true|false) ;;
  *) die "FLAKY_DETECT must be true|false (got '${FLAKY_DETECT}')" ;;
esac

# Validate rerun integers
[[ "${FLAKY_RERUNS}" =~ ^[0-9]+$ ]] || die "FLAKY_RERUNS must be integer (got '${FLAKY_RERUNS}')"
[[ "${FLAKY_MAX_RERUNS}" =~ ^[0-9]+$ ]] || die "FLAKY_MAX_RERUNS must be integer (got '${FLAKY_MAX_RERUNS}')"

if (( FLAKY_RERUNS < 1 )); then
  die "FLAKY_RERUNS must be >= 1 (got ${FLAKY_RERUNS})"
fi

# Clamp attempts to max (mitigation)
if (( FLAKY_RERUNS > FLAKY_MAX_RERUNS )); then
  echo "⚠️  [FLAKY-RERUN] Clamping FLAKY_RERUNS=${FLAKY_RERUNS} to max=${FLAKY_MAX_RERUNS}"
  FLAKY_RERUNS="${FLAKY_MAX_RERUNS}"
fi

# If disabled, run once exactly as before.
if [[ "${FLAKY_DETECT}" != "true" ]]; then
  echo "============================================================"
  echo "🧪 [FLAKY-RERUN] Disabled (FLAKY_DETECT=${FLAKY_DETECT})"
  echo "→ Running once: ${CMD[*]}"
  echo "============================================================"
  exec "${CMD[@]}"
fi

# -------------------------
# Rerun Mode
# -------------------------

mkdir -p "${FLAKY_EXPORT_PATH}"

echo "============================================================"
echo "🧪 [FLAKY-RERUN] Enabled"
echo "  total_attempts=${FLAKY_RERUNS}"
echo "  export_path=${FLAKY_EXPORT_PATH}"
echo "  label=${FLAKY_LABEL}"
echo "  command=${CMD[*]}"
echo "============================================================"

attempts_json="[]"
pass_count=0
fail_count=0
first_exit=0
LAST_EXIT=0

run_attempt() {
  local attempt="$1"
  local dir="${FLAKY_EXPORT_PATH}/attempt-${attempt}"
  local log="${dir}/${FLAKY_LABEL}.attempt.log"

  mkdir -p "${dir}"

  echo "------------------------------------------------------------"
  echo "🔁 [FLAKY-RERUN] Attempt ${attempt}/${FLAKY_RERUNS}"
  echo "    cmd: ${CMD[*]}"
  echo "    log: ${log}"
  echo "------------------------------------------------------------"

  local start end dur exit_code

  start="$(now_ms)"

  # Run while capturing logs but preserving exit code:
  # - `set +e` so failure doesn't exit the wrapper
  # - tee for evidence
  set +e
  (
    echo "[FLAKY-RERUN] attempt=${attempt} start_ms=${start}"
    "${CMD[@]}"
  ) 2>&1 | tee "${log}"
  # IMPORTANT: PIPESTATUS[0] is the subshell (your command), [1] is tee
  exit_code="${PIPESTATUS[0]}"
  set -e

  LAST_EXIT="${exit_code}"

  end="$(now_ms)"
  dur="$(( end - start ))"

  if (( exit_code == 0 )); then
    echo "✅ [FLAKY-RERUN] Attempt ${attempt} PASS (duration_ms=${dur})"
    pass_count=$((pass_count + 1))
  else
    echo "❌ [FLAKY-RERUN] Attempt ${attempt} FAIL exit=${exit_code} (duration_ms=${dur})"
    fail_count=$((fail_count + 1))
  fi

  # Build attempts list JSON entry (no jq dependency)
  local entry
  entry="{\"attempt\":${attempt},\"exit_code\":${exit_code},\"duration_ms\":${dur},\"log_path\":\"$(json_escape "${log}")\"}"

  if [[ "${attempts_json}" == "[]" ]]; then
    attempts_json="[${entry}]"
  else
    attempts_json="${attempts_json%]},"${entry}"]"
  fi
}

# Attempt 1 is always executed
run_attempt 1
first_exit="${LAST_EXIT}"

# If attempt #1 passes → exit 0, no reruns needed
if (( first_exit == 0 )); then
  flaky="false"
  status="success"
  echo "============================================================"
  echo "✅ [FLAKY-RERUN] Attempt 1 passed → no reruns required."
  echo "============================================================"
else
  # Attempt #1 failed → rerun up to N total attempts
  for ((i=2; i<=FLAKY_RERUNS; i++)); do
    run_attempt "${i}" || true
  done

  # Flaky if mixed outcomes across attempts
  if (( pass_count > 0 && fail_count > 0 )); then
    flaky="true"
  else
    flaky="false"
  fi

  status="failed"
fi

# Write summary.json
summary_path="${FLAKY_EXPORT_PATH}/${FLAKY_LABEL}.summary.json"
cmd_str="$(json_escape "${CMD[*]}")"
label_str="$(json_escape "${FLAKY_LABEL}")"

cat > "${summary_path}" <<EOF
{
  "flaky_detect": true,
  "status": "$(json_escape "${status}")",
  "label": "${label_str}",
  "total_attempts": ${FLAKY_RERUNS},
  "command": "${cmd_str}",
  "pass_count": ${pass_count},
  "fail_count": ${fail_count},
  "flaky": ${flaky},
  "attempts": ${attempts_json},
  "note": "If attempt 1 fails, this wrapper exits non-zero to avoid masking genuine failures."
}
EOF

echo "============================================================"
echo "🧾 [FLAKY-RERUN] Summary"
echo "  pass_count=${pass_count}"
echo "  fail_count=${fail_count}"
echo "  flaky=${flaky}"
echo "  summary=${summary_path}"
echo "============================================================"

# IMPORTANT POLICY: never mask original failure.
if (( first_exit != 0 )); then
  echo "⚠️  [FLAKY-RERUN] Original failure occurred on attempt 1 → exiting non-zero (exit=${first_exit})"
  exit "${first_exit}"
fi

exit 0
