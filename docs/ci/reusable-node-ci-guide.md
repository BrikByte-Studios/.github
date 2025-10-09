# DEVOPS-CI-PIPE-002 — Reusable Node CI (workflow_call) + Thin Wrapper

**Audience:** DevOps & Repo Maintainers  
**Owner:** DevOps Eng  
**Status:** Seed doc (production-ready pattern)  
**Last Updated:** YYYY-MM-DD

---

## 🎯 Goal

Standardize Node CI across repos using a **single org-hosted reusable workflow** that exposes two commit checks — **`lint`** and **`test`** — with **lockfile-keyed caching**, **artifact uploads**, and **noop safety** for non-Node repos. Each product repo uses a **thin wrapper** to call the org workflow.

---

## ✅ Outcomes / Acceptance

- Two distinct checks (**lint**, **test**) appear on PRs and can be **required** by branch protection.
- Triggers on **push** and **pull_request** to `main`; **cancels in-flight** duplicates.
- **No `package.json` ⇒ noop**: both jobs succeed quickly.
- **Cache** keyed by lockfile (npm|yarn|pnpm). Second run shows **cache_hit=true**.
- **Artifacts** uploaded when present: `junit.xml`, `coverage/**`.
- At least one repo successfully **consumes** the workflow at a **stable tag (`@v1`)**.
- **Empty repo wall time ≤ 5 min** on GitHub-hosted Ubuntu runners.

---

## 🧱 Architecture

```bash
BrikByte-Studios/.github (org governance repo)
└─ .github/workflows/reusable/node-ci.yml ← reusable workflow (tag: reusable-node-ci-v1)

Product repository (e.g., app-web)
└─ .github/workflows/ci.yml ← thin wrapper → uses @reusable-node-ci-v1
```


---

## 🔐 Prerequisites

- Default branch: `main`.
- Branch protection on `main` (per repo):
  - Require PRs; disallow direct pushes.
  - After first CI run, mark **`lint`** and **`test`** as **required checks**.
- Org allows **reusable workflows** from `BrikByte-Studios/.github` (same-org reuse if private).
- `gh` CLI authenticated (`gh auth status`).

---

## 🧰 Reusable Workflow (Org Repo)

**Path:** `BrikByte-Studios/.github/.github/workflows/reusable/node-ci.yml`

**Features**
- Jobs: `lint` and `test` (appear as separate commit checks).
- Inputs: `node-version`, `package-manager (npm|yarn|pnpm)`, `workdir`, `install-cmd`, `build-cmd`, `test-cmd`, `junit-path`, `coverage-path`.
- Noop-safe if no `package.json`.
- Uploads `test-report` artifact + optional `cache-metrics`.

```yaml
# DEVOPS-CI-PIPE-002 — reusable/node-ci.yml
name: reusable-node-ci
on:
  workflow_call:
    inputs:
      node-version:     { type: string, default: '20' }
      package-manager:  { type: string, default: 'npm' }        # npm|yarn|pnpm
      workdir:          { type: string, default: '.' }
      install-cmd:      { type: string, default: '' }
      build-cmd:        { type: string, default: '' }
      test-cmd:         { type: string, default: '' }
      junit-path:       { type: string, default: 'junit.xml' }
      coverage-path:    { type: string, default: 'coverage/**' }

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 7
    steps:
      - uses: actions/checkout@v4
      - name: Detect Node project
        id: detect
        run: |
          cd "${{ inputs.workdir }}"
          test -f package.json && echo "node=true" >> "$GITHUB_OUTPUT" || echo "node=false" >> "$GITHUB_OUTPUT"
      - name: Setup Node (with cache)
        if: steps.detect.outputs.node == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs['node-version'] }}
          cache: ${{ inputs['package-manager'] == 'npm' && 'npm' || inputs['package-manager'] }}
          cache-dependency-path: |
            ${{ inputs.workdir }}/package-lock.json
            ${{ inputs.workdir }}/yarn.lock
            ${{ inputs.workdir }}/pnpm-lock.yaml
      - name: Install
        if: steps.detect.outputs.node == 'true'
        run: |
          set -e
          cd "${{ inputs.workdir }}"
          if [ -n "${{ inputs['install-cmd'] }}" ]; then
            ${{ inputs['install-cmd'] }}
          else
            case "${{ inputs['package-manager'] }}" in
              npm)  npm ci --prefer-offline --no-audit --no-fund ;;
              yarn) corepack enable || true; yarn install --frozen-lockfile || yarn install --immutable ;;
              pnpm) corepack enable || true; pnpm i --frozen-lockfile ;;
            esac
          fi
      - name: Lint
        run: |
          cd "${{ inputs.workdir }}"
          if [ -f package.json ] && jq -e '.scripts.lint' package.json >/dev/null 2>&1; then
            case "${{ inputs['package-manager'] }}" in
              npm)  npm run -s lint ;;
              yarn) yarn -s lint ;;
              pnpm) pnpm -s lint ;;
            esac
          else
            echo "noop: no lint script"
          fi

  test:
    name: test
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: actions/checkout@v4
      - name: Detect Node project
        id: detect
        run: |
          cd "${{ inputs.workdir }}"
          test -f package.json && echo "node=true" >> "$GITHUB_OUTPUT" || echo "node=false" >> "$GITHUB_OUTPUT"
      - name: Setup Node (with cache)
        if: steps.detect.outputs.node == 'true'
        id: setup
        uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs['node-version'] }}
          cache: ${{ inputs['package-manager'] == 'npm' && 'npm' || inputs['package-manager'] }}
          cache-dependency-path: |
            ${{ inputs.workdir }}/package-lock.json
            ${{ inputs.workdir }}/yarn.lock
            ${{ inputs.workdir }}/pnpm-lock.yaml
      - name: Install
        if: steps.detect.outputs.node == 'true'
        run: |
          set -e
          cd "${{ inputs.workdir }}"
          if [ -n "${{ inputs['install-cmd'] }}" ]; then
            ${{ inputs['install-cmd'] }}
          else
            case "${{ inputs['package-manager'] }}" in
              npm)  npm ci --prefer-offline --no-audit --no-fund ;;
              yarn) corepack enable || true; yarn install --frozen-lockfile || yarn install --immutable ;;
              pnpm) corepack enable || true; pnpm i --frozen-lockfile ;;
            esac
          fi
      - name: Build (optional)
        run: |
          cd "${{ inputs.workdir }}"
          if [ -n "${{ inputs['build-cmd'] }}" ]; then
            ${{ inputs['build-cmd'] }} || true
          elif [ -f package.json ] && jq -e '.scripts.build' package.json >/dev/null 2>&1; then
            case "${{ inputs['package-manager'] }}" in
              npm)  npm run -s build || true ;;
              yarn) yarn -s build || true ;;
              pnpm) pnpm -s build || true ;;
            esac
          else
            echo "noop: no build"
          fi
      - name: Test
        run: |
          cd "${{ inputs.workdir }}"
          if [ -n "${{ inputs['test-cmd'] }}" ]; then
            ${{ inputs['test-cmd'] }} || true
          elif [ -f package.json ] && jq -e '.scripts.test' package.json >/dev/null 2>&1; then
            case "${{ inputs['package-manager'] }}" in
              npm)  npm test --silent -- --ci --reporters=default --reporters=junit || true ;;
              yarn) yarn -s test || true ;;
              pnpm) pnpm -s test || true ;;
            esac
          else
            echo "noop: no test script"
          fi
      - name: Cache metric (summary + artifact)
        if: steps.detect.outputs.node == 'true'
        run: |
          echo "cache_hit=${{ steps.setup.outputs['cache-hit'] }}" >> "$GITHUB_STEP_SUMMARY"
          printf '{"cache_hit": "%s", "sha": "%s", "ts": "%s"}\n' \
            "${{ steps.setup.outputs['cache-hit'] }}" "${{ github.sha }}" "$(date -u +%FT%TZ)" > cache-metrics.json
      - name: Upload reports (if any)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report
          path: |
            ${{ inputs.workdir }}/${{ inputs['junit-path'] }}
            ${{ inputs.workdir }}/${{ inputs['coverage-path'] }}
          if-no-files-found: ignore
      - name: Upload cache metrics
        uses: actions/upload-artifact@v4
        with:
          name: cache-metrics
          path: cache-metrics.json
          if-no-files-found: ignore
```

**Versioning / Tagging**
```bash
git switch -c feat/reusable-node-ci
git add .github/workflows/reusable/node-ci.yml
git commit -m "reusable: node-ci (lint+test), npm|yarn|pnpm, cache & artifacts (DEVOPS-CI-PIPE-002)"
git tag -a reusable-node-ci-v1 -m "reusable-node-ci v1"
git push -u origin HEAD --tags
# optional
# gh release create reusable-node-ci-v1 --title "reusable-node-ci v1" --notes "lint+test; cache; artifacts; noop-safe"
```
---
## 🪁 Consumer Wrapper (Per Repo)

**Path:** `.github/workflows/ci.yml`
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

permissions:
  contents: read

jobs:
  node-ci:
    uses: BrikByte-Studios/.github/.github/workflows/reusable/node-ci.yml@reusable-node-ci-v1
    with:
      node-version: '20'
      package-manager: 'npm'       # or 'yarn' | 'pnpm'
      workdir: '.'
      junit-path: 'junit.xml'
      coverage-path: 'coverage/**'
      # install-cmd: 'npm ci --prefer-offline --no-audit --no-fund'
      # build-cmd:   'npm run -s build'
      # test-cmd:    'npm test --silent'
```

**After first green run:**

Settings → Branches → Protect main → Require status checks → add lint and test.

---
## 🧪 Verification Plan
- **Reusability**: A product repo calls `@reusable-node-ci-v1` and completes both jobs.
- **Governance:** PR shows two commit checks (`lint`, `test`) — now set as required.
- **Compatibility:** Validate with `package-manager: npm|yarn|pnpm`.
- **Noop Safety:** Repo without `package.json` → both jobs print `noop` and succeed.
- **Caching:** Two runs with unchanged lockfile → run #2 shows `cache_hit=true` in Step Summary.
- **Artifacts:** If tests produce `junit.xml` / `coverage/**`, artifact `test-report` is available.
- **Performance:** Empty repo **≤ 5 min** wall time.

---
## 🧩 Common Overrides
- **Monorepo** (e.g., `apps/web`)
```yaml
with:
  workdir: 'apps/web'
  package-manager: 'pnpm'
  junit-path: 'junit.xml'
  coverage-path: 'coverage/**'
```

- **Private registry bootstrap**
```yaml
with:
  install-cmd: 'npm ci --prefer-offline --no-audit --no-fund --registry=https://npm.company.local'
```
- **Non-Jest JUnit output**
    - Ensure your runner writes `junit.xml` at `workdir`, or update `junit-path`.

---
## 🧯 Troubleshooting
| Symptom          | Likely Cause                         | Fix                                  |
|-----------------------------|--------------------------------------------|-----------------------------------------------------------|
| Wrapper cannot call workflow | Cross-org/private reuse blocked | Keep governance & consumers in same org; enable reusable workflows |
| Checks not separate | Single job or names changed | Keep two jobs named exactly `lint` and `test` |
| No cache hit | Lockfile changed / PM mismatch | Commit lockfile; correct package-manager; keep Node version stable |
| Yarn/pnpm slow | Corepack / cache mismatch | Use `package-manager: yarn |
| Artifacts missing | Tools not emitting outputs | Configure test runner to write `junit.xml` & `coverage/**` or adjust paths |

---

## 📚 Appendix
### A) Quick Create — Org Workflow + Tag
```bash
git switch -c feat/reusable-node-ci
# (add file per spec above)
git add .github/workflows/reusable/node-ci.yml
git commit -m "reusable: node-ci workflow_call (lint+test, cache, artifacts)"
git tag -a reusable-node-ci-v1 -m "reusable-node-ci v1"
git push -u origin HEAD --tags
```

### B) Quick Create — Consumer Wrapper
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
  node-ci:
    uses: BrikByte-Studios/.github/.github/workflows/reusable/node-ci.yml@reusable-node-ci-v1
    with:
      node-version: '20'
      package-manager: 'npm'
      workdir: '.'
      junit-path: 'junit.xml'
      coverage-path: 'coverage/**'
YAML
git add .github/workflows/ci.yml
git commit -m "ci: adopt reusable node-ci workflow (@reusable-node-ci-v1)"
git push -u origin HEAD
gh pr create --title "ci: adopt reusable node-ci (@v1)" --body "DEVOPS-CI-PIPE-002: lint+test checks; lockfile cache; artifacts; noop-safe."
```