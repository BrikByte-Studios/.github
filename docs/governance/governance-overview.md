# BrikByte Studios — Governance Overview

> This document explains **what the `.github` repo controls**, how policies are **applied and verified**, and how maintainers can **request changes**.

---

## 1) Purpose

This repository centralizes **organization-wide health files, templates, and guardrails** that shape how all BrikByte projects work (PR quality, issue intake, security posture, branch protection, etc.). It aims for **clarity, consistency, and auditability** across repos.

---

## 2) Scope (What this repo controls)

### 2.1 Community & Compliance Files
- `SECURITY.md` — vulnerability reporting, SLAs, safe harbor.
- `CODE_OF_CONDUCT.md` — community standards & enforcement.
- `LICENSE` — default license (MIT).
- `.github/CODEOWNERS` — review ownership & routing defaults.
- `.governance/break-glass.md` — emergency SOP.
- `.governance/policy.yml` — **branch-protection policy source of truth** (STRICT/SOLO).

### 2.2 PR & Issue Templates
- `.github/pull_request_template.md` — structured PR checklist (security, tests, rollout, etc.).
- `.github/ISSUE_TEMPLATE/bug_report.yml` — defect intake form (severity, repro, env).
- `.github/ISSUE_TEMPLATE/feature_request.yml` — features/RFC intake (value, AC, NFRs).

### 2.3 CI Guardrails (GitHub Actions)
- `pr-body-guard.yml` — **fails CI** if PR body has placeholders or empty required sections.
- `issue-triage.yml` — reads bug form text, **labels & routes** to teams with priority.
- `feature-triage.yml` — reads feature form text, **applies area/priority/rollout** labels.
- `issue-sla.yml` — **nightly** bug report SLA check (ack windows).
- `feature-sla.yml` — **nightly** feature request SLA & status progression checks.
- `compliance-branch-protection.yml` — **nightly drift check** against `/.governance/policy.yml`.
- `branch-protection-toggle.yml` — **switch profiles** (STRICT/SOLO) and export evidence.

---

## 3) Branch-Protection Policy (STRICT vs SOLO)

Policy lives in `/.governance/policy.yml` and defines:
- `mode:` `strict` or `solo`
- `branches:` (e.g., `["main"]`)
- Required checks per mode (e.g., `["lint","test","codeql"]` vs `["test"]`)

**STRICT (team repos)**  
- PR required, ≥1 approval, Code Owner review, up-to-date with base, signed commits ON, admins enforced.

**SOLO (solo maintainer)**  
- Direct push allowed, approvals OFF, Code Owner OFF, minimal checks (e.g., `test`), admins not enforced.  
- Still safe: linear history ON, force-push OFF, deletions OFF.

Switch via workflow run:
```bash
# STRICT
gh workflow run branch-protection-toggle --ref main -f mode=strict
# SOLO
gh workflow run branch-protection-toggle --ref main -f mode=solo
```
Evidence is exported to `.audit/YYYY-MM-DD/branch_protection_<branch>.json` and opened as a PR.

---

## 4) How Compliance Is Enforced

- **Preventive**: templates + `pr-body-guard.yml` block low-signal PRs; CODEOWNERS require the right reviewers.
- **Detective**: nightly `compliance-branch-protection.yml` fails if live settings drift from policy.
- **Responsive**: issue/feature **triage workflows** label + route so the right teams see items quickly.
- **Audit**: automated **evidence exports** under `.audit/` (+ PRs) for traceable changes.

---
## 5) Requesting Changes

1. **Open a PR to this repo** with:
    - Policy edits in `/.governance/policy.yml` (e.g., add a branch, change required checks).
    - Template or workflow changes under `.github/`.

2. **Explain rationale & impact** in the PR template (security, rollout, DoD).
3. **Approvals**: CODEOWNERS apply (DevOps + Security for governance-sensitive areas).
4. **Post-merge**: run the toggle if policy changed:
```bash
gh workflow run branch-protection-toggle --ref main
```
---

## 6) Quick Verification Commands
- **Current protection JSON:**
```bash
gh api repos/${OWNER}/${REPO}/branches/main/protection | jq .
```

- **Community profile has security policy:**
```bash
gh api repos/BrikByte-Studios/.github/community/profile | jq .
```

- **Evidence export present (example):**
```bash
ls -la .audit/$(date +%F)/branch_protection_main.json
```
---

## 7) Labeling & Status Conventions
- **Priority (features):** `priority/P0..P3`
- **Severity (bugs):** `severity/S1..S4`
- **Status (features):** `status/proposed → status/discovery → status/planned → status/in progress → status/done`
  
    - Alternate terminals: `status/rejected`, `status/needs-info`
- **Areas**: `area/ui`, `area/api`, `area/ci`, `area/cd`, `area/infra`, `area/observability`, `area/security`, `area/docs`, `area/data`

---

## 8) FAQ

- **Why do my pushes fail to `main`?**
    STRICT mode is on. Open a PR with required approvals/checks, or switch to SOLO (if appropriate) via the toggle workflow.

- **Why did my PR fail with “PR Body Guard — Issues Found”?**
    One or more required sections are empty/placeholder. Fill them with meaningful content and re-run checks.

- **Why didn’t my bug reach the right team?**
    Use the **Bug Report** form; triage workflow reads form fields and applies routing labels. Manual edits are allowed.

---

## 9) Glossary
- **Drift:** Live settings diverge from policy. Nightly job flags it.
- **Evidence:** JSON exports under `.audit/` proving the effective configuration.
- **Guardrail:** Automation that blocks or warns on non-compliant changes.

---

## 10)  Contact
- DevOps (governance owners): `@BrikByte-Studios/devops`
- Security (policy & exceptions): `@BrikByte-Studios/security`
- Docs: `@BrikByte-Studios/docs-platform`
  
---
SPDX-License-Identifier: MIT