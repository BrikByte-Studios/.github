#!/usr/bin/env bash
# Enforce strict branch protection (BrikByte)
# Usage:
#   ./bp_enforce.sh <owner/repo> [branch=auto] [contexts=lint,test,codeql]
# Example:
#   ./bp_enforce.sh BrikByte-Studios/.github main lint,test,codeql

set -euo pipefail
need(){ command -v "$1" >/dev/null || { echo "❌ missing: $1"; exit 127; }; }
need gh; need jq

REPO="${1:?Usage: $0 <owner/repo> [branch] [contexts=lint,test,codeql]}"
BRANCH="${2:-$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name)}"
CTX_CSV="${3:-lint,test,codeql}"

IFS=',' read -r -a CTX_ARR <<< "$CTX_CSV"
CHECKS_JSON="$(printf '%s\n' "${CTX_ARR[@]}" | jq -R . | jq -s 'map({context:.})')"
CONTEXTS_JSON="$(printf '%s\n' "${CTX_ARR[@]}" | jq -R . | jq -s .)"

echo "🔐 Enforcing strict protection on $REPO @ $BRANCH"
echo "   Required checks: ${CTX_ARR[*]}"

PAYLOAD_CHECKS=$(jq -n \
  --argjson checks "$CHECKS_JSON" '
  {
    required_status_checks: { strict: true, checks: $checks },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 1
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true
  }')

PAYLOAD_CONTEXTS$(jq -n \
  --argjson contexts "$CONTEXTS_JSON" '
  {
    required_status_checks: { strict: true, contexts: $contexts },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 1
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true
  }')

# Try modern payload; fallback to legacy
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

# Enable required signatures (separate endpoint)
set +e
gh api -X POST "repos/$REPO/branches/$BRANCH/protection/required_signatures" >/dev/null 2>&1
set -e

# Evidence + summary
DAY="$(date +%F)"; mkdir -p ".audit/$DAY"
gh api "repos/$REPO/branches/$BRANCH/protection" \
  > ".audit/$DAY/branch_protection_${BRANCH}_strict.json"
gh api "repos/$REPO/branches/$BRANCH/protection/required_signatures" \
  > ".audit/$DAY/required_signatures_${BRANCH}.json"

echo "📄 Strict summary:"
jq -r '
  . as $p |
  "  - enforce_admins: \($p.enforce_admins.enabled // .enforce_admins)",
  "  - strict status checks: \($p.required_status_checks.strict)",
  "  - required contexts: \((($p.required_status_checks.checks // []) | map(.context)) + ($p.required_status_checks.contexts // []) | unique | join(\", \"))",
  "  - approvals: \($p.required_pull_request_reviews.required_approving_review_count // 0)",
  "  - code owner reviews: \($p.required_pull_request_reviews.require_code_owner_reviews // false)",
  "  - dismiss stale: \($p.required_pull_request_reviews.dismiss_stale_reviews // false)",
  "  - linear history: \($p.required_linear_history // false)",
  "  - allow force pushes: \($p.allow_force_pushes // false)",
  "  - allow deletions: \($p.allow_deletions // false)",
  "  - conversation resolution: \($p.required_conversation_resolution // false)"
' ".audit/$DAY/branch_protection_${BRANCH}_strict.json"
echo "🧾 Evidence written to .audit/$DAY/"
echo "✅ Strict protection enforced."
