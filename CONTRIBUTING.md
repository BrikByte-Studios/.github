# Contributing to BrikByteOS

Welcome! This repo follows org-wide governance from [`brikbyte/.github`](https://github.com/BrikByte-Studios/.github).
Please read this guide before opening issues or PRs.

---

## Table of Contents
- [Contributing to BrikByteOS](#contributing-to-brikbyteos)
  - [Table of Contents](#table-of-contents)
  - [How to Propose Changes](#how-to-propose-changes)
  - [Issue Types \& Triage](#issue-types--triage)
  - [Pull Requests](#pull-requests)
  - [Branching \& Commits](#branching--commits)
  - [Testing \& Quality Gates](#testing--quality-gates)
  - [Labels \& Conventions](#labels--conventions)
  - [Security](#security)
  - [Dependencies \& Dependabot](#dependencies--dependabot)
  - [Docs \& Changelog](#docs--changelog)
  - [Governance \& Ownership](#governance--ownership)
  - [FAQ / Troubleshooting](#faq--troubleshooting)

---

## How to Propose Changes

1. **Search existing issues/PRs** to avoid duplicates.
2. **Open an Issue** using the appropriate **Issue Form**:
   - 🐞 **Bug Report** — defects or regressions
   - 🌟 **Feature Request** — new capability or improvement
   - 🔐 **Security Report** — confidential triage (see [Security](#security))
3. For features or larger changes, include:
   - Problem statement, acceptance criteria, risks, and rollout
   - Links to ADR/design docs if applicable

> Tip: Blank issues are disabled. Use the forms so we capture the details needed for fast triage.

---

## Issue Types & Triage

- Initial triage applies `needs-triage` and an **area:** label (e.g., `area:api`, `area:infra`).
- Bugs should include **severity (S1–S4)** and **frequency** from the form.
- Priority labels (`priority:P1|P2|P3`) are set by maintainers.
- Status labels: `status:triaged`, `status:in-progress`, `status:blocked`, `status:needs-info`, etc.

SLA (guideline):
- **New issues:** triaged within 2 business days.
- **S1 / security:** same-day acknowledgment.

---

## Pull Requests

**Use the PR template** — it auto-loads when you open a PR.

Minimum checklist:
- Clear summary (business/user impact)
- Linked issue (e.g., `Closes #123`)
- Tests added/updated as needed
- All CI gates green (`lint`, `test`, `codeql`)
- Code Owner approvals (if touching `.github/*` or owned code)

Small PRs merge faster. If a PR exceeds ~400 lines net change, consider splitting.

---

## Branching & Commits

- **Branch naming:** `feat/<scope>/*`, `fix/<scope>/*`, `chore/<scope>/*`
- **Conventional Commits** for titles:
  - `feat(api): add bulk export`
  - `fix(ui): correct card spacing`
  - `chore(ci): tighten workflow permissions`
- **Breaking changes:** include `!` and use `semver:major` label.

Signed commits are recommended if your local setup supports it.

---

## Testing & Quality Gates

Run locally before pushing:
```bash
# examples — adjust to project
npm run lint
npm test
# or:
make lint test
```

PRs must pass:
- `lint` ✅ static checks
- `test` ✅ unit/integration
- `codeql` ✅ security scan
- (optional) E2E/UI (Playwright), API (Karate), Perf (k6) when relevant

Our nightly compliance workflow verifies Issue Forms, PR template, labels, and Dependabot config, and commits an evidence pack to `/.audit/YYYY-MM-DD/`.

---

## Labels & Conventions

Core labels:
- Type: `bug`, `enhancement`, `documentation`, `security`, `type:chore`, `type:test`, `type:ci`
- Priority: `priority:P1|P2|P3`
- Area: `area:ui`, `area:api`, `area:infra`, `area:observability`, `area:docs`, etc.
- SemVer impact: `semver:major|minor|patch`
- Workflow: `needs-triage`, `status:in-progress`, `status:blocked`, `status:needs-info`

Labels are **seeded idempotently** from `.github/labels.yml`. Please don’t hand-edit colors; update the spec and run the seed workflow instead.

---

## Security
- Report vulnerabilities via 🔐 **Security Report** issue form or the repository **Security Policy** page.
- **Do not include** secrets or PII in issues/PRs or logs.
- Security fixes may be handled in private forks/branches until disclosure.

---

## Dependencies & Dependabot

- Dependabot runs **weekly** for:
  - `npm` (grouped dev-deps minor/patch)
  - `docker`
  - `github-actions`

- Safe **auto-merge** is restricted to Dependabot PRs labeled `dev-deps` or `semver:patch`, after required checks pass.

- For noisy upgrades, propose rules (grouping, ignores) via PR to `.github/dependabot.yml`.

To force a check, open the repo’s **Security → Dependabot** page and click Check for updates.

---
## Docs & Changelog

- Update `README.md`, relevant docs/ADRs, and add a **changelog entry** for user-visible changes.
- For UI/API changes, include screenshots or contract snippets in the PR.

---
## Governance & Ownership

- Changes to `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `.github/labels.yml`, `.github/dependabot.yml` require approval from `@BrikByte-Studios/devops` (enforced by **CODEOWNERS** and branch protection).

- Org-wide policies live in `BrikByte-Studios/.github`. This repo consumes those via reusable workflows.

---
## FAQ / Troubleshooting
**Issue forms don’t appear?**
Ensure files exist under `.github/ISSUE_TEMPLATE/` and `config.yml` has `blank_issues_enabled: false`.

**Labels don’t match colors?**
Run the **Labels Seed** workflow; compliance will fail on mismatches and open an audit PR with `labels.json`.

**Dependabot seems idle?**
Confirm `.github/dependabot.yml` exists, then use **Security → Dependabot → Check for updates**. A PR should appear if updates are available.

**Compliance failed?**
Open the latest run, check the logs under “Assertions”, and follow the message (missing template, label mismatch, or dependabot file absent). A branch like `audit/compliance-YYYY-MM-DD` will include evidence.

----
Thank you for contributing! 🎉