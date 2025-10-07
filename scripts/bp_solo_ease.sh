#!/usr/bin/env bash
# Ease branch protection for solo operator (BrikByte)
# Usage:
#   ./bp_solo_ease.sh <owner/repo> [branch=auto] [--allow-force-push] [--allow-deletions]
# Example:
#   ./bp_solo_ease.sh BrikByte-Studios/.github main

set -euo pipefail
need(){ command -v "$1" >/dev/null || { echo "❌ missing: $1"; exit 127; }; }
need gh; need jq

REPO="${1:?Usage: $0 <owner/repo> [branch] [--allow-force-push] [--allow-deletions]}"
BRANCH="${2:-$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name)}"
ALLOW_FORCE="false"
ALLOW_DELETE="false"
[[ "${3:-}" == "--allow-force-push" ]] && ALLOW_FORCE="true"
[[ "${4:-}" == "--allow-deletions"  ]] && ALLOW_DELETE="true"

echo "🧩 Easing protection on $REPO @ $BRANCH (solo mode)"
echo "   allow_force_pushes=$ALLOW_FORCE, allow_deletions=$ALLOW_DELETE"

# Build payloads (empty checks/contexts; not strict; no reviews; admins not enforced)
PAYLOAD_CHECKS=$(jq -n \
  --argjson checks '[]' \
  --argjson allow_force $ALLOW_FORCE \
  --argjson allow_delete $ALLOW_DELETE '
  {
    required_status_checks: { strict: false, checks: $checks },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: $allow_force,
    allow_deletions: $allow_delete,
    block_creations: false,
    required_conversation_resolution: false
  }')

PAYLOAD_CONTEXTS=$(jq -n \
  --argjson contexts '[]' \
  --argjson allow_force $ALLOW_FORCE \
  --argjson allow_delete $ALLOW_DELETE '
  {
    required_status_checks: { strict: false, contexts: $contexts },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: $allow_force,
    allow_deletions: $allow_delete,
    block_creations: false,
    required_conversation_resolution: false
  }')

# Try modern payload first; fallback to legacy schema
set +e
RES=$(gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - <<<"$PAYLOAD_CHECKS" 2>&1)
RC=$?
set -e
if [[ $RC -ne 0 || "$RES" == *"422"* ]]; then
  echo "ℹ️  Fallback to legacy 'contexts' schema"
  gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - <<<"$PAYLOAD_CONTEXTS" >/dev/null
else
  echo "✅ Applied using 'checks' schema"
fi

# Disable required signatures (separate endpoint, ignore if already off)
set +e
gh api -X DELETE "repos/$REPO/branches/$BRANCH/protection/required_signatures" >/dev/null 2>&1
set -e

# Evidence + summary
DAY="$(date +%F)"; mkdir -p ".audit/$DAY"
gh api "repos/$REPO/branches/$BRANCH/protection" \
  > ".audit/$DAY/branch_protection_${BRANCH}_solo.json"
echo "📄 Solo summary:"
jq -r '
  . as $p |
  "  - enforce_admins: \($p.enforce_admins.enabled // .enforce_admins)",
  "  - strict status checks: \($p.required_status_checks.strict)",
  "  - required contexts: \((($p.required_status_checks.checks // []) | map(.context)) + ($p.required_status_checks.contexts // []) | unique | join(", "))",
  "  - approvals (null means none): \($p.required_pull_request_reviews.required_approving_review_count // "none")",
  "  - code owner reviews: \($p.required_pull_request_reviews.require_code_owner_reviews // false)",
  "  - linear history: \($p.required_linear_history // false)",
  "  - allow force pushes: \($p.allow_force_pushes // false)",
  "  - allow deletions: \($p.allow_deletions // false)"
' ".audit/$DAY/branch_protection_${BRANCH}_solo.json"
echo "🧾 Evidence written to .audit/$DAY/"
