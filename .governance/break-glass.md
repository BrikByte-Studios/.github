# Break-Glass Procedure (Controlled Emergency Change)

> Purpose: Allow a **time-boxed, audited bypass** of branch protections to ship a **Sev1/Sev2 hotfix** while preserving traceability and rapid re-hardening.

- **Applies to:** `main` and any `release/*` branches in BrikByte repos governed by org policy.
- **Bypass mechanism:** Temporarily disable **enforce_admins** on protected branch → merge exactly **one** hotfix PR → immediately re-apply full protections.
- **Time box:** ≤ **30 minutes** from relax → restore.
- **Audit:** Every step must be captured under `/.audit/<YYYY-MM-DD>/`.

---

## 1) When to Use (Eligibility)

Use only for:
- **Sev1:** Outage, security incident, or data-loss risk.
- **Sev2:** Major customer impact with SLA breach imminent.

**Do not use** for routine releases, refactors, dependency bumps, or convenience.

---

## 2) Roles & Dual-Control

- **Requester / Incident Commander (IC):** Opens hotfix PR with incident link.
- **Approver A (CTO/Eng Lead)** and **Approver B (Security Lead):** Approve bypass.
- **Executor (DevOps On-Call):** Runs commands to relax/restore protections.
- **Auditor (Compliance/PMO):** Verifies evidence, files PIR.

> **Dual-control:** Executor cannot proceed without Approver A + B sign-off recorded in the PR.

---

## 3) Preconditions (All Required)

- Incident ticket (e.g., `INC-YYYY-####`) with severity, impact, and rollback plan.
- Hotfix PR from `hotfix/<date>-<slug>` targeting the protected branch.
- PR body contains the **Break-Glass Checklist** (below) fully filled.
- Named approvers confirmed in PR comments.
- Executor has `gh` CLI authenticated with org-admin token.

### Break-Glass Checklist (paste in PR)
- [ ] Incident: `INC-YYYY-####` — link:
- [ ] Severity: (Sev1 / Sev2)
- [ ] Blast radius & impact:
- [ ] Fix description & risk:
- [ ] Rollback plan (commit SHA / revert steps):
- [ ] Approver A (CTO/Eng Lead): @handle — ✅ Approved
- [ ] Approver B (Security Lead): @handle — ✅ Approved
- [ ] Evidence folder planned: `/.audit/YYYY-MM-DD/INC-####/`

---

## 4) Minimal-Override Policy

We relax **only** what is necessary to merge the hotfix:

- Change **`enforce_admins` → false** (admins may merge without checks).
- **Do not** enable force-push or branch deletion.
- Keep: linear history, required status checks (still configured), signed commits, code scanning, etc.

---

## 5) Step-by-Step (Deterministic)

> Replace `ORG=BrikByte-Studios`, `REPO=.github`, `BRANCH=main` accordingly.

### 5.1 Export Current Protection (pre-state)
```bash
ORG=BrikByte-Studios REPO=.github BRANCH=main DAY=$(date +%F)
mkdir -p .audit/$DAY/INC-PLACEHOLDER
gh api repos/$ORG/$REPO/branches/$BRANCH/protection \
  > .audit/$DAY/INC-PLACEHOLDER/branch_protection_pre.json
```
### 5.2 Relax Admin Enforcement (time-boxed)
```bash
gh api -X PUT repos/$ORG/$REPO/branches/$BRANCH/protection \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f enforce_admins=false \
  -f required_signatures=true \
  -F required_status_checks.strict=true
```
- Record timestamp and command (minus secrets) into:

```bash
echo "$(date -Iseconds) relax enforce_admins=false by $USER for INC-####" \
  >> .audit/$DAY/INC-PLACEHOLDER/break-glass.log
```
### 5.3 Merge Exactly One Hotfix PR
- Use Squash merge with message:

```pgsql
BREAKGLASS: INC-#### <one-line fix summary>
Signed-off-by: <executor name> <email>
```
- Capture PR URL and merge SHA to the log file.

### 5.4 Immediately Re-Apply Full Protection (restore)
```bash
# Re-apply strict org standard (example contexts: lint, test, codeql)
gh api -X PUT repos/$ORG/$REPO/branches/$BRANCH/protection \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f enforce_admins=true \
  -f required_signatures=true \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]='lint' \
  -F required_status_checks.contexts[]='test' \
  -F required_status_checks.contexts[]='codeql' \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F required_pull_request_reviews.require_code_owner_reviews=true \
  -F required_pull_request_reviews.dismiss_stale_reviews=true

gh api repos/$ORG/$REPO/branches/$BRANCH/protection \
  > .audit/$DAY/INC-PLACEHOLDER/branch_protection_post.json

echo "$(date -Iseconds) restore enforce_admins=true by $USER" \
  >> .audit/$DAY/INC-PLACEHOLDER/break-glass.log
```

### 5.5 Verify & Pin Evidence
```bash
# Quick verify: admins enforced again?
jq -r '.enforce_admins.enabled' .audit/$DAY/INC-PLACEHOLDER/branch_protection_post.json
# => true

# Commit evidence via PR
git checkout -b audit/$DAY/INC-#### && git add .audit/$DAY/INC-PLACEHOLDER
git commit -m "audit: BREAKGLASS evidence INC-#### ($DAY)"
git push -u origin audit/$DAY/INC-####
```
Open PR: **“audit: BREAKGLASS evidence INC-####”** and link it to the incident and hotfix PR.

---

## 6) Rollback Plan

If the hotfix degrades service:

1. `git revert <merge-SHA>` via a normal PR (no break-glass unless severity persists).
2. If break-glass is again required, repeat this procedure with a new incident ID.

---

## 7) Post-Incident Review (PIR)

Within `5 business days`:
- File a PIR doc linking: incident, hotfix PR, evidence PR, logs, and timelines.
- Add preventive controls (tests, rules, monitors) to avoid recurrence.
- Update runbooks and SLOs if needed.

---

## 8) Logging & Evidence Requirements

Store at minimum:

```swift
/.audit/YYYY-MM-DD/INC-####/
  branch_protection_pre.json
  branch_protection_post.json
  break-glass.log
  hotfix_pr_url.txt
  merge_sha.txt
  screenshots/ (optional)
```

---

## 9) Non-Permitted Actions
- Disabling required signatures, force-push enablement, or branch deletions.
- Using break-glass without dual approvals.
- Keeping protections relaxed beyond the 30-minute SLA.
- Bypassing for non-emergency work.

---

## 10)  FAQs
**Q:** Why not disable status checks?
**A:** We only relax admin enforcement; status checks remain configured for normal ops. Admins can merge during the window; we re-apply immediately after.

**Q:** Can we do this on `release/*`?
**A:** Yes—same steps with `BRANCH=release/x.y`.

---

## 11) Contact
- Approver A: CTO/Eng Lead — @cto-handle
- Approver B: Security Lead — @security-handle
- Executor: DevOps On-Call — @devops-oncall
- Auditor: Compliance/PMO — @pmo-handle

---

## ✅ Acceptance Criteria (Objective, Testable)

| Area | Criterion | Proof |
|---|---|---|
| Policy file | `.governance/break-glass.md` exists and renders | `gh api repos/BrikByte-Studios/.github/contents/.governance/break-glass.md` |
| Pre-state export | `branch_protection_pre.json` captured before relax | File present under `/.audit/<date>/INC-####/` |
| Relax action | Log shows timestamp + executor + `enforce_admins=false` | `break-glass.log` entry |
| Single hotfix PR | PR merged with `BREAKGLASS:` prefix and incident ID | PR link + merge SHA stored |
| Restore action | Post-state JSON shows `enforce_admins.enabled=true` | `jq -r '.enforce_admins.enabled' ... == true` |
| Time box | Log shows relax→restore ≤ 30 minutes | Compare timestamps in `break-glass.log` |
| Evidence PR | “audit: BREAKGLASS evidence INC-####” merged | PR URL recorded |
| PIR filed | PIR doc linked within 5 business days | Link in incident ticket |

---

## 🛠️ Optional Helper Script (drop into `/scripts/break_glass.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
ORG=${1:?org} REPO=${2:?repo} BRANCH=${3:-main} INC=${4:?incident-id}
DAY=$(date +%F); BASE=".audit/$DAY/$INC"; mkdir -p "$BASE"

echo "[*] Export pre-state"
gh api repos/$ORG/$REPO/branches/$BRANCH/protection > "$BASE/branch_protection_pre.json"

echo "[*] Relax enforce_admins=false"
gh api -X PUT repos/$ORG/$REPO/branches/$BRANCH/protection \
  -f required_linear_history=true -f allow_force_pushes=false -f allow_deletions=false \
  -f enforce_admins=false -f required_signatures=true -F required_status_checks.strict=true
echo "$(date -Iseconds) relax enforce_admins=false" >> "$BASE/break-glass.log"

echo "[!] Merge exactly ONE hotfix PR manually, then press Enter to continue"
read -r

echo "[*] Restore full protection"
gh api -X PUT repos/$ORG/$REPO/branches/$BRANCH/protection \
  -f required_linear_history=true -f allow_force_pushes=false -f allow_deletions=false \
  -f enforce_admins=true -f required_signatures=true -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]='lint' \
  -F required_status_checks.contexts[]='test' \
  -F required_status_checks.contexts[]='codeql' \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F required_pull_request_reviews.require_code_owner_reviews=true \
  -F required_pull_request_reviews.dismiss_stale_reviews=true
gh api repos/$ORG/$REPO/branches/$BRANCH/protection > "$BASE/branch_protection_post.json"
echo "$(date -Iseconds) restore enforce_admins=true" >> "$BASE/break-glass.log"

echo "[*] Verify:"
jq -r '.enforce_admins.enabled' "$BASE/branch_protection_post.json"
```

---

## 🗒️ Maintainer Comments & Documentation
- Link this document from your governance release notes (governance-v1.0).
- Add a “Break-Glass used” label and PR template checkbox to ease discovery.
- Ensure your nightly compliance job alerts if enforce_admins is found false.