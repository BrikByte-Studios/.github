# BrikByte Studios — CODEOWNERS Guide

This document explains how we route reviews with `CODEOWNERS`, which teams own which areas, and how to safely evolve these rules.

---

## 1) Purpose

- Ensure **the right reviewers** are requested automatically.
- Encode **clear ownership** for sensitive/governance paths.
- Provide **auditable** and **predictable** review routing.

> GitHub rule: the **last matching pattern wins**. Order matters.

---

## 2) Team Matrix

| Domain / Capability          | GitHub Team Handle                         | Primary Responsibilities                                  |
|-----------------------------|--------------------------------------------|-----------------------------------------------------------|
| DevOps / Platform           | `@BrikByte-Studios/devops`                 | CI/CD, infra tooling, runners, images, pipelines          |
| Security                    | `@BrikByte-Studios/security`               | Policies, secrets, supply chain, branch protection        |
| SRE                         | `@BrikByte-Studios/sre`                    | Reliability, k8s, observability, incident response        |
| QA / Test Automation        | `@BrikByte-Studios/qa-automation`          | E2E, API/UI tests, test frameworks                        |
| Docs Platform               | `@BrikByte-Studios/docs-platform`          | Docs standards, READMEs, changelogs, site builds          |

> Adjust handles to your org’s actual team slugs as needed.

---

## 3) Path Ownership (Patterns)

These patterns mirror the org-wide defaults you’ll find in `.github/CODEOWNERS`.
Use them as your baseline for **all repositories**.

```text
# NOTE: Last match wins. Keep the global fallback early so specific rules below override it.

# Global fallback (most files)
*                                         @BrikByte-Studios/devops @BrikByte-Studios/qa-automation

# --- Sensitive / governance (lock these down) ---
/.github/                                  @BrikByte-Studios/devops @BrikByte-Studios/security
/.github/workflows/                        @BrikByte-Studios/devops @BrikByte-Studios/security
/.github/CODEOWNERS                        @BrikByte-Studios/devops @BrikByte-Studios/security
/.governance/**                            @BrikByte-Studios/devops @BrikByte-Studios/security
/SECURITY.md                               @BrikByte-Studios/security
/CODE_OF_CONDUCT.md                        @BrikByte-Studios/security @BrikByte-Studios/docs-platform
/LICENSE                                   @BrikByte-Studios/devops

# --- Infra / deploy surfaces ---
/infra/**                                  @BrikByte-Studios/devops @BrikByte-Studios/sre
/k8s/**                                    @BrikByte-Studios/devops @BrikByte-Studios/sre
/helm/**                                   @BrikByte-Studios/devops @BrikByte-Studios/sre
/terraform/**                              @BrikByte-Studios/devops @BrikByte-Studios/sre
/Dockerfile                                @BrikByte-Studios/devops
/docker-compose*.yml                       @BrikByte-Studios/devops

# --- App surfaces (rooted; adjust to ** if nested) ---
/backend/**                                @BrikByte-Studios/devops @BrikByte-Studios/qa-automation
/frontend/**                               @BrikByte-Studios/devops @BrikByte-Studios/qa-automation
/qa/**                                     @BrikByte-Studios/qa-automation

# --- Optional monorepo conventions ---
/apps/**                                   @BrikByte-Studios/devops @BrikByte-Studios/qa-automation
/packages/**                               @BrikByte-Studios/devops @BrikByte-Studios/qa-automation

# --- Docs & comms ---
/docs/**                                   @BrikByte-Studios/docs-platform
/README.md                                 @BrikByte-Studios/docs-platform
/CHANGELOG.md                              @BrikByte-Studios/docs-platform

# --- Audit evidence (optional but useful) ---
/.audit/**                                 @BrikByte-Studios/devops @BrikByte-Studios/security
```

**Tips**
- Use `/**` to match all nested files & folders.
- Keep **specific rules below** general ones (because “last match wins”).
- If a repo has a different structure (e.g., `src/`), mirror the same intent:
    - `/src/backend/**`, `/src/frontend/**`, etc.

---

## 4) When to Add/Change Ownership

Add/modify rules when:
- A new area emerges (e.g., new `apps/` service).
- A team’s remit changes (e.g., SRE now owns `observability/`).
- Governance paths expand (e.g., `.governance/` or policy files).
- Docs responsibility moves (e.g., developer education team).

**Process**
1. Open a PR in the **central `.github` repo** (org-wide baseline) and/or the target repository if it needs overrides.
2. Explain the ownership **rationale** and **impacts** in the PR template.
3. CODEOWNERS teams will review and approve.

---

## 5) Testing Your CODEOWNERS
- **Local dry-run:** (GitHub doesn’t provide an official local tester, but you can sanity check by opening a PR in a test repo and verifying requested reviewers.)
- **Minimal PR:** Touch a file under your pattern and ensure the right **team** is **auto-requested.**
- Confirm **no unintended owners** are triggered by overlapping rules (watch “last match wins”).

---
## 6) Common Gotchas

- **Order matters.** Place specific paths after the global fallback.
- **Typos in team slugs** break reviewer assignment (no error thrown until PR).
- **Hidden files/folders:** Remember to cover .`github/`, `.governance/`, etc.
- **Monorepos:** Keep patterns **short but precise;** avoid over-broad captures that drag in unrelated services.

---
## 7) Escalations & Exceptions

- For temporary exceptions (e.g., break-glass on governance files), follow
`/.governance/break-glass.md` and include **post-incident review.**
- For long-term ownership changes, update this guide and `.github/CODEOWNERS`.

---

## 8) Maintenance Checklist

- [ ] Teams and slugs still valid.
- [ ] All sensitive paths are owned by **Security** + **DevOps**.
- [ ] App/infra patterns reflect current repo layout.
- [ ] Docs owners receive reviews for READMEs/CHANGELOGs.
- [ ] `.audit/` (if committed) is owned appropriately.

---
## 9) Quick Reference
- **Global fallback:** `* @devops @qa-automation`
- **Governance:** `.github/**`, `.governance/**` → `@devops @security`
- **Infra:** `infra/**`, `k8s/**`, `helm/**`, `terraform/**` → `@devops @sre`
- **Apps:** `backend/**`, `frontend/**`, `qa/**` → `@devops` + area teams
- **Docs:** `docs/**`, `README.md`, `CHANGELOG.md` → `@docs-platform`

Keep the **central baseline** in the org `.github` repo; add repo-specific overrides only when necessary.

---

**Owners**

- DevOps (primary maintainers of CODEOWNERS): `@BrikByte-Studios/devops`
- Security (governance-sensitive review): `@BrikByte-Studios/security`
- Docs (documentation quality): `@BrikByte-Studios/docs-platform`

SPDX-License-Identifier: MIT