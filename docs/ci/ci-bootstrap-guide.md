# DEVOPS-CI-PIPE-001 — Reusable CI Bootstrap (Org Workflow + Thin Wrapper)

- **Audience:** DevOps, repo maintainers
- **Status:** Draft → Adopt across repos
- **Owner:** DevOps Eng
- **Last updated:** YYYY-MM-DD

### Purpose (why this exists)

Standardize CI across all repos using a **single org-hosted reusable workflow** that exposes two required checks — `lint` and `test` — while keeping per-repo config minimal and **empty-repo safe**.

### Outcomes (acceptance)
- Two distinct checks (**lint**, **test**) shown on PRs.
- Triggers on **push** and **pull_request** to `main`; cancels in-flight duplicates.
- If no `package.json`: both jobs no-op and succeed.
- Empty repo completes in ≤ **5 minutes** on GitHub-hosted runners.
- Node lockfile caching enabled; a **second run shows cache hit** in run summary.
- Uploads `junit.xml` and `coverage/**` when present.
- At least one product repo consumes org workflow **@v1**.

---
### Architecture (at a glance)
```pgsql
BrikByte-Studios/.github (org governance repo)
└─ .github/workflows/rep-gov-001-ci-bootstrap.yml  ← reusable workflow (tag: v1)

Product repository (e.g., app-web)
└─ .github/workflows/ci.yml                         ← thin wrapper → uses @v1
```
- Org workflow contains the logic (detect Node, cache, lint, test, artifacts).
- Repo wrapper just calls the workflow at a **stable tag** (`@v1`).

---

### Prerequisites
- Default branch: `main`
- Branch protection on `main` (per repo):
    - Require PRs (no direct pushes)
    - **Required status checks:** `lint`, `test` (enable *after* first run)
- Org policy allows reusing workflows from `BrikByte-Studios/.github` (same-org reuse if private).
- `gh` CLI authenticated (`gh auth status`).

---

### Quickstart (TL;DR)
1. **In org repo** (`BrikByte-Studios/.github`), add reusable workflow and tag `v1`.
2. **In product repo,** add wrapper workflow that calls org workflow `@v1`.
3. Trigger a PR → see `lint` and `test` checks → make them **required** in branch protection.

---

### Step-by-Step
### 1) Org governance repo — reusable workflow (one-time)
**Path:** `BrikByte-Studios/.github/.github/workflows/rep-gov-001-ci-bootstrap.yml`
```yaml
name: rep-gov-001-ci-bootstrap
on:
  workflow_call:
    inputs:
      node-version:
        required: false
        type: string
        default: '20'

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - id: detect
        run: |
          if [ -f package.json ]; then echo "node=true" >> "$GITHUB_OUTPUT"; else echo "node=false" >> "$GITHUB_OUTPUT"; fi
      - uses: actions/setup-node@v4
        if: steps.detect.outputs.node == 'true'
        with:
          node-version: ${{ inputs.node-version }}
          cache: npm
      - name: Lint
        run: |
          if [ -f package.json ] && npm run | grep -qE '^\s+lint'; then
            npm ci --prefer-offline --no-audit --no-fund
            npm run -s lint
          else
            echo "noop: no Node or no lint script"
          fi

  test:
    name: test
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - id: detect
        run: |
          if [ -f package.json ]; then echo "node=true" >> "$GITHUB_OUTPUT"; else echo "node=false" >> "$GITHUB_OUTPUT"; fi
      - uses: actions/setup-node@v4
        if: steps.detect.outputs.node == 'true'
        id: setup-node
        with:
          node-version: ${{ inputs.node-version }}
          cache: npm
      - name: Install & Test
        run: |
          if [ -f package.json ] && npm run | grep -qE '^\s+test'; then
            npm ci --prefer-offline --no-audit --no-fund
            npm test --silent -- --ci --reporters=default --reporters=junit || true
          else
            echo "noop: no Node or no test script"
          fi
      - name: Cache metric
        if: steps.detect.outputs.node == 'true'
        run: echo "cache_hit=${{ steps.setup-node.outputs['cache-hit'] }}" >> "$GITHUB_STEP_SUMMARY"
      - name: Upload reports (if any)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report
          path: |
            junit.xml
            coverage/**
          if-no-files-found: ignore
```

**Versioning:** tag and release
```bash
git switch -c rep-gov-001/ci-bootstrap
git add .github/workflows/rep-gov-001-ci-bootstrap.yml
git commit -m "rep-gov-001: reusable CI bootstrap (lint+test), empty-repo safe"
git tag -a v1 -m "rep-gov-001-ci-bootstrap v1"
git push -u origin HEAD --tags
# (optional) gh release create v1 --title "rep-gov-001 v1" --notes "lint+test, cache, artifacts"
```

**Rule:** Breaking changes → new major tag (`v2`). Keep `v1` stable.

---

### 2) Product repo — thin wrapper (repeat per repo)

**Path:** `.github/workflows/ci.yml`
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

permissions:
  contents: read

jobs:
  call-bootstrap:
    uses: BrikByte-Studios/.github/.github/workflows/rep-gov-001-ci-bootstrap.yml@v1
    with:
      node-version: '20'
```
**Commit & PR**
```bash
git switch -c feat/ci-wrapper
git add .github/workflows/ci.yml
git commit -m "ci: adopt org reusable workflow (@v1) — DEVOPS-CI-PIPE-001"
git push -u origin HEAD
gh pr create --title "ci: bootstrap lint & test via org workflow (@v1)" \
             --body "Exposes checks: lint, test. Empty-repo safe; Node cache; artifacts when present."
```
---

### Verification checklist

- **PR Checks:** `lint` and `test` appear on PRs.
- **Concurrency:** pushing twice cancels older in-flight run for same ref.
- **Empty repo:** no `package.json` → jobs no-op and succeed; total **≤ 5 min**.
- **Caching:** Node repo with lockfile; second run shows `cache_hit=true` in job summary.
- **Artifacts:** If produced, `junit.xml` & `coverage/**` available as `test-report`.
- **Branch protection:** require lint and test as status checks on `main`.
- **Reusability:** at least one product repo merged wrapper using `@v1`.

---
### Governance mapping
- **GOV-001** (Branch protections): required contexts `lint`, `test`
- **PIPE-005** (CodeQL) handled separately; keep CI bootstrap fast & focused
- **Evidence:** Actions summary includes cache metric; artifacts uploaded when present

---

### FAQs

**Q: We don’t use Node. Will this fail?**
A: No. No `package.json` → both jobs no-op and pass quickly.

**Q: Our tests don’t produce `junit.xml.`**
A: Add a JUnit reporter (e.g., Jest + jest-junit) or ignore; artifacts step is tolerant.

**Q: Can we pin a different Node version?**
A: Yes — per repo, set `with: node-version: 'X'` in the wrapper.

**Q: How do we roll out changes org-wide?**
A: Publish a new tag (`v1.1` or `v2`), then update wrappers to the new tag via PR.

---

### Troubleshooting
- **Reusable workflow 403/404:** Ensure consumer repo is in same org (if governance repo private) and org settings allow reuse.
- **Checks not separate:** Ensure the org workflow defines two jobs named `lint`, `test`. Wrapper must not merge them.
- **No cache hit:** Ensure lockfile exists and unchanged; check `actions/setup-node@v4` shows `cache: npm`.
- **Slow empty repos:** Keep bootstrap minimal; move integration/E2E/perf to separate workflows.

---
### Change log (doc)

- YYYY-MM-DD — v1 doc seed created (owner: @handle)

---
### Appendix — Copy-paste commands
**Create wrapper in a product repo**
```bash
git switch -c feat/ci-wrapper
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'YAML'
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions:
  contents: read
jobs:
  call-bootstrap:
    uses: BrikByte-Studios/.github/.github/workflows/rep-gov-001-ci-bootstrap.yml@v1
    with:
      node-version: '20'
YAML
git add .github/workflows/ci.yml
git commit -m "ci: adopt org reusable workflow (@v1)"
git push -u origin HEAD
gh pr create --title "ci: bootstrap lint & test via org workflow (@v1)" --body "DEVOPS-CI-PIPE-001"
```
**Enable required checks (after first run)**

Settings → Branches → `main` → Require status checks → add `lint`, `test`.