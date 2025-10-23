# BrikByte Studios — **.github** Standards Repo

This repository is the **org-wide source of truth** for:
- Reusable GitHub Actions workflows (`reuse-*.yml`)
- Issue/PR templates and config
- Security/governance docs (SECURITY.md, CONTRIBUTING.md, CODEOWNERS)

All product repos **consume** the workflows here; changes in this repo can affect the entire org.  
Use feature branches + PRs with required approvals (Security + Platform).

---

## 📦 Repository Layout
```text
.github/
    workflows/ # Reusable workflows (workflow_call)
        reuse-build-test.yml
        reuse-metadata-lint.yml
        reuse-security-codeql.yml
        reuse-security-supplychain.yml
        reuse-archlint.yml
        reuse-container.yml
        reuse-docs.yml
        reuse-release.yml
        reuse-pr-quality.yml
    ISSUE_TEMPLATE/ # Issue forms + config
        bug.yml
        feature.yml
        rfc.yml
        task.yml
        config.yml
PULL_REQUEST_TEMPLATE.md
CODEOWNERS
SECURITY.md
CONTRIBUTING.md
README.md (this file)
```


---

## ✅ Quick Start (for Maintainers)

```bash
git clone https://github.com/BrikByte-Studios/.github
cd .github

# Run local checks (requires: actionlint, yamllint)
make pr.check

# Create a feature branch
git checkout -b feat/reuse-build-test-updates

# Edit workflows/docs → then commit & push
git add -A && git commit -m "feat(reuse-build-test): add python cache" && git push -u origin HEAD

# Open a PR via CLI
gh pr create --base main --title "feat(reuse-build-test): add python cache" --body "See README for inputs/outputs; canary green."

# After merge → tag standards release
make release.tag VERSION=v1.0.1-standards
# update floating major when appropriate
make release.v1
```
---
## 🔁 How Consumers Call Reusable Workflows

From a service repo (e.g., `brikbyteos-sample-service/.github/workflows/ci.yml`):

```yaml
name: CI (Reuse)
on: [push, pull_request]
jobs:
  build:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-build-test.yml@v1
    with:
      language: node
      run-tests: true

  metadata:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-metadata-lint.yml@v1
```

---
## 🧰 Reusable Workflows Catalog
All workflows are reusable (`on: workflow_call`). See each file for full comments.

### 1) `reuse-build-test.yml`

**Inputs**
- `language` (required): `node|python|java`
- `run-tests` (bool, default `true`)
- `cache-key` (string, optional)

**Guarantees**
- Sets up toolchain, caches deps, installs, runs `make check` (fallbacks to lang tests), uploads coverage.

**Caller**
```yaml
jobs:
  build:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-build-test.yml@v1
    with:
      language: node
```
---
### 2) `reuse-metadata-lint.yml`
**Inputs:** none

**Guarantees:** Validates `LICENSE` (SPDX + year + org), README contract sections, `.gitattributes` LF policy, `.gitignore` allowlist, secret scan (gitleaks).

**Caller**
```yaml
jobs:
  metadata:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-metadata-lint.yml@v1
```
---

### 3) `reuse-security-codeql.yml`

**Inputs**
- `languages` (csv string), e.g., `"javascript,python"`
**Guarantees**
- CodeQL init → analyze; results visible in repo **Security → Code scanning**.

**Caller**
```yaml
jobs:
  codeql:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-security-codeql.yml@v1
    with:
      languages: "javascript,python"
```
---
### 4) `reuse-security-supplychain.yml`

**Inputs**
- `sbom`: `cyclonedx|spdx` (default `cyclonedx`)
- `scan`: `trivy|grype` (default `trivy`)

**Guarantees**
- Generates SBOM; scans dependencies; uploads SARIF (Code Scanning) + SBOM artifact.

**Caller**
```yaml
jobs:
  supplychain:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-security-supplychain.yml@v1
    with:
      sbom: cyclonedx
      scan: trivy
```
---
### 5) `reuse-archlint.yml`

**Inputs**
- `config` (path, default `.archlint.yml`)

**Guarantees**
- Minimal DDD guard (apps/packages/infra presence), uploads JSON report (placeholder for future rules).

**Caller**
```yaml
jobs:
  arch:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-archlint.yml@v1
```
---
### 6) `reuse-container.yml`

**Inputs**
- `image-name` (required), `registry` (default `ghcr.io`)
- `build-context` (default `.`), `dockerfile` (default `Dockerfile`)
- `tags` (default `latest`) — comma-separated

**Secrets**
- `registry-username`, `registry-password` (optional; non-GHCR)

**Guarantees**
- buildx with cache, GHCR login via `GITHUB_TOKEN` or custom registry creds, pushes image.

**Caller**
```yaml
jobs:
  img:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-container.yml@v1
    with:
      image-name: brikbyteos-sample-service
      registry: ghcr.io
      dockerfile: infra/docker/Dockerfile
      tags: latest,sha-${{ github.sha }}
```

---
### 7) `reuse-docs.yml`
**Inputs**
- `docs-tool`: `mkdocs|docusaurus` (default `mkdocs`)
- `publish`: boolean (default `false`)

**Guarantees**
- Builds docs; optionally publishes to GitHub Pages.

**Caller**
```yaml
jobs:
  docs:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-docs.yml@v1
    with:
      docs-tool: mkdocs
      publish: true
```

---
### 8) `reuse-release.yml`

**Inputs**
- `tag` (required), e.g., `v0.0.3-metadata`
- `changelog` (default `true`)
- `registry` (reserved, default `ghcr`)

**Guarantees**
- Creates tag (idempotent) and GitHub Release with auto notes.

**Caller**
```yaml
jobs:
  release:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-release.yml@v1
    with:
      tag: v0.0.3-metadata
```
---
### 9) `reuse-pr-quality.yml`

**Inputs**
- `enforce-title` (default `true`)
- `auto-label` (default `true`)

**Guarantees**
- Conventional-commit PR title lint; simple auto-labeling.

**Caller**
```yaml
jobs:
  prq:
    if: github.event_name == 'pull_request'
    uses: BrikByte-Studios/.github/.github/workflows/reuse-pr-quality.yml@v1
```

---
## 🛡️ Org Settings (Actions → General)

- **Actions:** enabled for all repos; **Allow reusable workflows from this organization**
- **Workflow permissions:** Read & Write (token can write)
- **Approved actions:** GitHub-verified; allowlist of third-parties (Security-approved)
- **Environments:** `staging`, `prod` with reviewers `@devops` (for release/container deploy)
- **Runners:** hosted Ubuntu; add self-hosted labels as needed

---
## 📋 Issue & PR Templates

- Issues: **Bug, Feature, RFC, Task** via forms (`.github/ISSUE_TEMPLATE/*.yml`)
- PRs: `PULL_REQUEST_TEMPLATE.md` checklist (tests, docs, security, linked issue, rollback)

---
## 👮 Governance & Approvals
- `CODEOWNERS` requires:
    - Workflows → `@security` + `@devops`
    - Templates/docs → `@devops` + `@docs-platform`
- Branch protection: PRs only, linear history, all required checks green.

---
## 🧪 Canary Proof (required for changes)

Every workflow change must be proven on a canary repo (e.g., `brikbyteos-sample-service`):

```yaml
name: CI (Canary → Reuse)
on: [push, pull_request]
jobs:
  build:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-build-test.yml@v1
    with: { language: node, run-tests: true }

  metadata:
    uses: BrikByte-Studios/.github/.github/workflows/reuse-metadata-lint.yml@v1

  pr-quality:
    if: github.event_name == 'pull_request'
    uses: BrikByte-Studios/.github/.github/workflows/reuse-pr-quality.yml@v1
```
Checks must be green and artifacts present (coverage, metadata report, etc.).

---
## BrikByteOS Quality Baselines

This directory documents the **canonical rulepacks** and **reusable CI** for linting, formatting,
and commit-message policy across the BrikByte organization.

### Contents
- `rulepacks/eslint.js.base.json` — ESLint baseline for JS/TS monorepos (React via overrides)
- `rulepacks/prettier.base.json` — Prettier configuration (100 cols, LF, single quotes)
- `rulepacks/commitlint.base.js` — Conventional Commits (type(scope): subject, 100 chars)
- `.github/workflows/reuse-lint.yml` — reusable lint + format + optional commitlint
- `.github/workflows/reuse-pr-quality.yml` — PR title lint + optional auto-label

### How to Consume (service repo)
1. **Configs**
   - Copy the rulepacks into your repo, or reference them via templates.
   - Create:
     - `.eslintrc.json` extending the ESLint base (or inline copy)
     - `.prettierrc.json` using the Prettier base
     - `commitlint.config.js` requiring the org baseline
2. **Scripts** (in `package.json`)
   ```json
   {
     "scripts": {
       "lint": "eslint .",
       "lint:fix": "eslint . --fix",
       "format:check": "prettier . --check",
       "format:write": "prettier . --write",
       "commitlint:ci": "commitlint --from=origin/main --to=HEAD || commitlint --last"
     }
   }
   ```
3. **CI (recommended)**
  
    ```yaml
    jobs:
    lint:
      uses: BrikByte-Studios/.github/.github/workflows/reuse-lint.yml@v1
      with:
        node-version: '20'
        run-commitlint: true

    pr-quality:
      if: github.event_name == 'pull_request'
      uses: BrikByte-Studios/.github/.github/workflows/reuse-pr-quality.yml@v1
      with:
        enforce-title: true
        auto-label: true
    ```
4. **Branch Protection**
- Add required check: `lint` (job name from the caller workflow)
- Optionally require `pr-quality` on PRs.

---
## 🧯 Troubleshooting

- **“Invalid workflow file (inline maps)”** → avoid `{ … }` around expressions. Use block style:
```yaml
with:
  languages: ${{ inputs.languages }}
```
- **Hyphenated keys** → bracket notation: `inputs['image-name']`, `secrets['registry-password']`.
- **Secrets in** `if:` → don’t. Move to `env:` and check in shell.
- **Artifacts from dot-dirs** → set `include-hidden-files: true`.
- `npm ci` **without lockfile** → generate once: `npm i --package-lock-only` then `npm ci`.

### Commitlint fails but there’s no config in the repo
The reusable workflow falls back to `@commitlint/config-conventional`. Prefer adding
`commitlint.config.js` that re-exports the org baseline.

### PR title lint complains about scope

We require `type(scope): subject`. Example:
```scss
feat(api): add healthcheck endpoint
```

### ESLint complains about parserOptions.project

If you don’t have a `tsconfig.json`, either add one, or remove `parserOptions.project` in your local .eslintrc.json.

---
## 🧭 Versioning & Deprecation

- Standards tags: `vMAJOR.MINOR.PATCH-standards` (e.g., `v1.0.1-standards`)
- Floating `v1` tag for compatible updates
- **Breaking changes:**
    - Open an RFC Issue
    - Bump **MAJOR**
    - Document migration in README and PR body
    - Keep `@v1` working until consumers migrate

---
## 🗂 Changelog (Standards)

Track releases via Git tags and GitHub Releases in this repo.
Include: what changed, any new inputs/outputs, migration steps, and affected consumers.

---
## 📚 References
- **Contributing:** CONTRIBUTING.md
- **Security Policy:** SECURITY.md
- **Docs Hub:** https://github.com/BrikByte-Studios/brikbyteos-docs

---
_Last updated: 2025-10-19_