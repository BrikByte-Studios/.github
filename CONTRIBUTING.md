# Contributing Guide — BrikByte Studios **.github** (Standards Repo)

This repository hosts **org-wide reusable workflows**, **Issue/PR templates**, and **security/governance policies** that other BrikByte repos consume.  
Because changes here affect every team, **quality gates and reviews are strict**.

---

## 🔎 What lives in this repo?

- `.github/workflows/reuse-*.yml` – **reusable** GitHub Actions
- `.github/ISSUE_TEMPLATE/*.yml` – Issue forms (+ `config.yml`)
- `PULL_REQUEST_TEMPLATE.md`
- `CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `README.md`

> Consumers call these workflows like:
>
> ```yaml
> jobs:
>   build:
>     uses: BrikByte-Studios/.github/.github/workflows/reuse-build-test.yml@v1
>     with:
>       language: node
> ```

---

## ✅ Contribution checklist (TL;DR)

1. **Open an Issue** (Feature/RFC/Bug/Task form) describing the change.
2. Create a branch: `feat/reuse-<area>` / `fix/<problem>` / `chore/<scope>`.
3. **Implement + test**: run local lint/validation (see Make targets below).
4. Update **docs** in `README.md` (inputs/outputs/usage) for any edited workflow.
5. Open a PR with a **Conventional Commit** title and complete the PR checklist.
6. Ensure **required checks** are green and **CODEOWNERS** approve.
7. **Tag** a new standards release (e.g., `v1.0.1-standards`) and update the floating `v1` tag if appropriate.
8. Verify a **canary repo** (e.g., `brikbyteos-sample-service`) runs green using the new tag.

---

## 🧰 Local setup

You can work on this repo like any other:

```bash
git clone https://github.com/BrikByte-Studios/.github
cd .github
```
### Recommended tools
- **actionlint** (strict workflow linter)
- **yamllint** (strict YAML linter)
- **jq** (JSON processor)
- **gh** (GitHub CLI)
- **shellcheck** (shell script linter)
  
Mac:
```bash
brew install actionlint yamllint jq gh shellcheck
```

Ubuntu:
```bash
sudo apt-get update
sudo apt-get install -y yamllint jq
curl -sSL https://github.com/rhysd/actionlint/releases/latest/download/actionlint_$(uname -s)_$(uname -m).tar.gz \
| sudo tar -xz -C /usr/local/bin actionlint
```
---
## 🧱 Branching, commits, and PRs
- **Branches:** `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`
- **Commit messages:** Conventional Commits (e.g., `feat(reuse-build-test): add python cache`)
- **PR title:** must pass PR-title lint (enforced by `reuse-pr-quality.yml`)
- **Link an Issue:** use GitHub keywords (`Fixes #123`)

---
## 🔐 Reviews & approvals
- **Required approvers** (via CODEOWNERS):
    - Workflows: `@BrikByte-Studios/security` + `@BrikByte-Studios/devops`
    - Templates/docs: `@BrikByte-Studios/devops` + `@BrikByte-Studios/docs-platform`
- **Branch protection:** PRs only, linear history, all checks green.

---
## 🧪 Testing reusable workflows
1. **Canary caller** in `brikbyteos-sample-service`:
```yaml
jobs:
  build:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-build-test.yml@<branch-or-tag>
    with:
      language: node
```
2. Push a PR in the canary repo and **verify green**.
3. Switch callers to the tag (not `@main`) once released.

Use a **feature tag** for pre-release (e.g., `v1.0.1-rc.1-standards`) to avoid breaking consumers.

---
## 🔒 Security & supply chain rules
- **Only GitHub-verified actions** plus an allowlist approved by Security (see Org settings).
- **Pin by major** (e.g., `@v4`) or **digest** where feasible; upgrade follows semver.
- Avoid `curl | bash` installs in workflows; use official setup actions.
- Use OIDC for cloud auth (ACR/ECR) rather than long-lived secrets.
- All changes run through **CodeQL** and **SBOM/Trivy** in downstream repos.

---
## 🧾 Documentation expectations

If you change any `reuse-*.yml`, update:
- `README.md` (this repo): add/adjust the **inputs**, **outputs**, and **guarantees** bullets.
- Example **caller snippet**.
- Any **breaking change** must include migration notes and a **minor/major** tag bump.

---
## 🧲 Versioning & release policy
- Semantic versioning for standards: `vMAJOR.MINOR.PATCH-standards` (e.g., `v1.2.3-standards`)
- Maintain a floating tag `v1` for **compatible** updates.
- **Breaking changes:**
    - Require an RFC Issue
    - Bump **MAJOR**
    - Provide a migration guide and a deprecation window where possible

Tagging:
```bash
# after PR merge
make tag.preview
make release.tag VERSION=v1.0.1-standards
# when ready to move the major pointer:
make release.v1
```
---
## 📝 PR template checklist (what reviewers expect)

- [ ] Conventional Commit title
- [ ] `wf.lint` & `docs.check` pass locally (or in CI)
- [ ] README updated (inputs/outputs/usage)
- [ ] Canary repo green with the change
- [ ] Security considerations addressed (pinned actions, permissions minimal)
- [ ] Rollback plan described (how to revert & impact)
- [ ] Linked Issue (bug/feature/RFC/task)

---
## 🧯 Rollback

If a reusable breaks consumers:
1. Immediately pin affected repos to a **known good tag** (e.g., @v1.0.0-standards).
2. Revert or hotfix here; publish `vX.Y.Z-standards` patch.
3. Announce in the engineering channel and open a post-incident note.

---
## 🧩 Tips & common patterns
- **Hyphenated input names:** reference with bracket syntax in expressions
`inputs['image-name']` (not `inputs.image-name`)

- **Expressions in YAML:** prefer **block** maps:
```yaml
with:
  languages: ${{ inputs.languages }}
```

(Avoid `{ languages: ${{ inputs.languages }} }`)
- **Secrets** in `if:`: don’t. Move values to `env:` and check in shell.
- **Include dot-dirs in artifacts:**
```yaml
with:
  path: .audit/**/*
  include-hidden-files: true
```

---
## 📣 Communication & support

- Ask in **#platform-devops** / **#security** (Slack) for workflow design questions.
- Update **brikbyteos-docs** when adding capabilities that affect product teams.

---
## 💬 Code of Conduct

Be respectful, collaborative, and constructive. This repo is a shared platform component.
Violations follow the org policy.

---
_Last updated: 2025-10-19_