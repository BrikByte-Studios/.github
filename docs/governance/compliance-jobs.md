# BrikByte Studios — Compliance Jobs (Drift Detection & Response)

This page explains the automated jobs that keep our repos compliant, how they **detect drift**, and what happens when they do.

> TL;DR — We codify policy in files and workflows. Nightly jobs compare **actual state** (GitHub, issues, PRs) to **policy** (in-repo YAML & templates). Any mismatch raises noise in CI, applies labels, and opens evidence PRs in `.audit/…`.

---

## 1) Why this exists

- **Prevent silent drift:** branch protection, review rules, status checks, and SLA labels often change over time (sometimes accidentally).
- **Make policy visible:** guardrails are code (policy-as-code) and produce **evidence** for audits.
- **Fast feedback:** engineers see problems in GitHub UI (checks, labels), not in a private spreadsheet.

---

## 2) What jobs run?

### 2.1 Branch-Protection Compliance
- **Workflow:** `.github/workflows/compliance-branch-protection.yml`
- **Policy source:** `.governance/policy.yml`
- **When:** nightly (cron) + manual `workflow_dispatch`
- **Detects:** Branch protection on listed branches differs from policy profile (**STRICT** or **SOLO**).
- **Signals (Failure):**
  - Workflow **fails** with a readable diff-style message (e.g., “missing required status check ‘codeql’”).
  - Optional evidence JSON under `.audit/YYYY-MM-DD/branch_protection_<branch>.json`.
- **Auto-response:** none (by design). This job **only checks**. Use the toggle below to remediate.

### 2.2 Branch-Protection Toggle (Remediator)
- **Workflow:** `.github/workflows/branch-protection-toggle.yml`
- **When:** on-demand `workflow_dispatch` input `mode=solo|strict`
- **Does:** Applies policy knobs to protected branches (approvals, code-owners, required checks, signed commits, etc.).
- **Evidence:** Commits `.audit/YYYY-MM-DD/branch_protection_<branch>.json` on a new branch and opens a PR.

### 2.3 PR Body Guard (Template Enforcement)
- **Workflow:** `.github/workflows/pr-body-guard.yml`
- **When:** on PR open/edit/synchronize
- **Detects:** Placeholders (“…”, `<scope>`, empty required sections), missing checked boxes under **What Changed**, non-conformant titles.
- **Signals:** Check **fails** and prints exact issues in the job summary. Prevents merge via required checks.

### 2.4 Issue Triage (Bug / Feature)
- **Workflows:**  
  - `.github/workflows/issue-triage.yml` (bugs)  
  - `.github/workflows/feature-triage.yml` (features)
- **When:** on issue open/edit/labels
- **Detects:** Reads Issue Forms content (Scope, Severity/Priority, Areas, Rollout) and **applies labels**:
  - `severity/S1..S4`, `priority/P0..P3`, `area/ui|api|infra|…`, `rollout/flag|canary|…`
- **Signals:** Bot comment with a **Triage Summary** and mentions routed teams per CODEOWNERS matrix.

### 2.5 SLA Monitors (Acknowledge/Status)
- **Workflows:**  
  - `.github/workflows/issue-sla.yml` (bugs)  
  - `.github/workflows/feature-sla.yml` (features)
- **When:** nightly (cron)
- **Detects:** SLA breaches based on timestamps and labels.
  - **Bug SLA:** Acknowledgement deadlines by Severity (e.g., S1 ≤ 1 business day).
  - **Feature SLA:** Acknowledge by Priority (P0 ≤1d, P1 ≤2d, P2 ≤5d, P3 ≤10d) and **status ladder** sanity: `status/proposed → discovery → planned → in progress → done` (or `rejected`, `needs-info`).
- **Signals:** Adds `sla/breached` (+ a reason label like `sla/ack`), and posts/updates a bot comment summary.

---

## 3) What is “drift” here?

**Drift** = “Reality differs from policy.” Examples:

- **Branch protection drift:** A required check deleted, approvals reduced from ≥1 to 0, or admins no longer enforced while policy says they must be.
- **Template drift:** PR descriptions skipping mandatory sections despite policy; guard catches it.
- **SLA drift:** High-priority/critical issues not acknowledged within policy windows.
- **Routing drift:** Issues missing labels that route to correct teams — triage jobs apply/repair these.

---

## 4) Policy-as-Code Sources

- **Branch protection:** `.governance/policy.yml`  
  ```yaml
  mode: strict | solo
  branches:
    - main
  checks:
    strict: { contexts: ["lint","test","codeql"] }
    solo:   { contexts: ["test"] }
    ```
- **CODEOWNERS:** `.github/CODEOWNERS` (teams and patterns)
- **PR Template:** `.github/pull_request_template.md` (sections the guard enforces)
- **Issue Forms:** `.github/ISSUE_TEMPLATE/*.yml` (Bug/Feature fields drive triage)

---
## 5) Response Playbooks
### 5.1 Branch-Protection check failed
1. Open the failed run → read mismatch lines (e.g., missing `codeql`).
2. Decide: **apply policy** or **update policy.**
    - To **apply policy:** run **Branch-Protection Toggle** with the intended `mode`.
        - STRICT ⇒ approvals ≥1, codeowners on, checks: `lint,test,codeql`, signed commits on, etc.
        - SOLO ⇒ direct pushes allowed (no reviews), checks: `test`, signed commits off, etc.
    - To **update policy:** PR edit `.governance/policy.yml`, merge, then re-run compliance (should turn green).
3. Keep the evidence PRs from the toggle for audits.


### 5.2 PR Body Guard failed
- Expand the run summary → fix the exact items (replace placeholders, fill sections, check at least one **What Changed** item, adjust title to `type: scope — summary`).
- Push an edit to the PR body → job re-runs/passes.

### 5.3 SLA breach labels appeared
- The bot comment shows the **reason** (e.g., “no maintainer comment within P1 window”).
- Acknowledge: comment with intent/next step; set appropriate **status**/ label.
- If mis-labeled severity/priority, update labels; SLA job will recalc on next run.

---
## 6) Evidence & Audit
- **Where:** `.audit/YYYY-MM-DD/` (JSON exports and optional logs) created by toggle runs.
- **How it’s captured:** Toggle workflow runs `gh api` to fetch the **authoritative** branch-protection representation and commits it on a short-lived audit branch with an auto-opened PR.

`.audit/` is gitignored by default to avoid clutter; workflows force-add it on audit branches only.

---
## 7) Dashboards & Signals
- **Checks tab** on PRs → PR Body Guard pass/fail.
- **Actions tab** → nightly compliance and SLA runs (red = drift).
- **Labels** on issues → `severity/*`, `priority/*`, `area/*`, `status/*`, and `sla/*` reflect **current state** at a glance.
- Optional: pipe run results to your chat/ops channel via a notifier step.

---

## 8) Troubleshooting
- **403 “Resource not accessible by integration”**
Use a PAT with admin rights for branch-protection endpoints: store as `secrets.ADMIN_TOKEN`; export to `GH_TOKEN`.
- **“Unexpected value 'administration'” in permissions**
The `permissions`: block does not support an `administration` key. Use a PAT; keep `contents: write` for audit PRs.
- **Audit PR push rejected (branch exists)**
Use a **unique branch name** per run (`audit/<date>-<run_id>-<attempt>`). The provided workflows already do this.
- **.audit ignored**
It’s in `.gitignore`. The workflow uses `git add -f` to force-add.

---
## 9) Extending the System
- **Add more checks:** e.g., enforcing “require branches up-to-date” in STRICT — extend the compliance script assertions.
- **Repo subsets:** put multiple branches in `policy.yml` under `branches: [main, release/*]`.
- **Org rollouts:** move the same workflows to the central org `.github` repo and scope with `if: startsWith(github.repository, 'BrikByte-Studios/')`.

---

## 10) Operational RACI

- **Responsible:** DevOps (maintains workflows, policy yaml)
- **Accountable:** CTO / Eng Lead
- **Consulted:** Security (STRICT profile), QA (required checks), SRE (observability)
- **Informed:** All maintainers via audit PRs and failing checks
---
## 11) Quick Reference (Runbooks)
- **Switch to STRICT:**
    Actions → **branch-protection-toggle** → `mode=strict` → confirm evidence PR.

- **Switch to SOLO:**
Actions → **branch-protection-toggle** → `mode=solo` → confirm evidence PR.

- **Fix nightly red:**
Read mismatch, decide **apply policy** vs **change policy**, then rerun compliance.

---
SPDX-License-Identifier: MIT