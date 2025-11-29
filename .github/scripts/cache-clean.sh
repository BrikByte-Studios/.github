#!/usr/bin/env bash
# =============================================================================
# BrikByteOS — Cache Clean Utility
# -----------------------------------------------------------------------------
# Task: PIPE-CACHE-STRATEGY-CONFIG-004
#
# Purpose:
#   Provide a small, idempotent script to clear one or more cache directories
#   used by CI (Node, Python, JVM, Go, .NET, etc.), without causing builds to
#   fail if paths are missing or already clean.
#
# Key properties:
#   - SAFE: Does not fail if a target path does not exist.
#   - VERBOSE: Logs all actions to help debugging.
#   - CONFIGURABLE:
#       • Accepts CACHE_PATHS env var (comma- or newline-separated list).
#       • Also accepts paths as CLI arguments.
#
# Usage in CI:
#
#   # Using env var (comma-separated):
#   - name: "Clean cache directories"
#     run: |
#       CACHE_PATHS="${HOME}/.npm,${HOME}/.cache/pip" \
#         .github/scripts/cache-clean.sh
#
#   # Using CLI args:
#   - name: "Clean JVM caches"
#     run: |
#       .github/scripts/cache-clean.sh \
#         "${HOME}/.m2/repository" \
#         "${HOME}/.gradle/caches"
#
# Notes:
#   - Use for:
#       • Manual cache refresh (workflow_dispatch).
#       • Recovery logic when cache corruption is suspected.
#   - The script will exit 0 unless a non-path-related error occurs.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Helper: print a log line with a consistent prefix.
# -----------------------------------------------------------------------------
log() {
  # shellcheck disable=SC2145
  echo "[CACHE-CLEAN] $@"
}

# -----------------------------------------------------------------------------
# 1) Collect target paths
#
# Order of precedence:
#   1) Command-line arguments
#   2) CACHE_PATHS env var (comma or newline separated)
# -----------------------------------------------------------------------------
paths=()

if [ "$#" -gt 0 ]; then
  # CLI arguments supplied
  for arg in "$@"; do
    if [ -n "${arg}" ]; then
      paths+=("${arg}")
    fi
  done
elif [ -n "${CACHE_PATHS:-}" ]; then
  # CACHE_PATHS env var supplied
  #   - Supports comma-separated or newline-separated lists.
  #   - Example:
  #       CACHE_PATHS="$HOME/.npm,$HOME/.cache/pip"
  #       CACHE_PATHS=$'~/.npm\n~/.cache/pip'
  IFS=$',\n' read -r -a paths <<< "${CACHE_PATHS}"
fi

if [ "${#paths[@]}" -eq 0 ]; then
  log "No cache paths provided via arguments or CACHE_PATHS; nothing to do."
  exit 0
fi

log "Starting cache cleanup for ${#paths[@]} path(s)..."

# -----------------------------------------------------------------------------
# 2) Clean each path
# -----------------------------------------------------------------------------
for raw_path in "${paths[@]}"; do
  # Skip empty entries (can occur with trailing commas).
  if [ -z "${raw_path}" ]; then
    continue
  fi

  # Expand '~' and environment variables in the path
  expanded_path=$(eval "echo \"${raw_path}\"")

  if [ -d "${expanded_path}" ]; then
    log "Removing directory: ${expanded_path}"
    rm -rf -- "${expanded_path}"
    log "Removed: ${expanded_path}"
  elif [ -f "${expanded_path}" ]; then
    # In some cases caches may be single files (e.g., packed caches).
    log "Removing file: ${expanded_path}"
    rm -f -- "${expanded_path}"
    log "Removed: ${expanded_path}"
  else
    log "Path not found, skipping: ${expanded_path}"
  fi
done

log "Cache cleanup completed successfully."

# Exit 0 even if some paths were missing; this is an idempotent utility.
exit 0