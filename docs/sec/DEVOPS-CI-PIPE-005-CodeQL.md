# DEVOPS-CI-PIPE-005 — Reusable CodeQL Setup (Org Workflow + Thin Wrapper)

> **Goal:** Ship a **drop-in, reusable CodeQL workflow** in the org governance repo that is **language-aware**, **skip-safe** for non-code repos, and **easy to adopt** via a thin per-repo wrapper. Produces Code Scanning alerts and a clear run summary.

---

## 1) Executive Summary

This guide provides:
- A **reusable workflow** published in `BrikByte-Studios/.github` that detects relevant code, supports **autobuild** or **manual build**, and uploads **SARIF**.
- A **per-repo wrapper** that opts a repository into CodeQL with minimal YAML.
- **Skip-safety:** doc/infra-only repos short-circuit as green with a clear reason.
- **Evidence:** job summary includes detected languages, code presence, and build mode.

---

## 2) Inputs & Defaults

Reusable workflow inputs (override in consumers as needed):

| Input               | Default                                      | Notes |
|---------------------|----------------------------------------------|------|
| `languages`         | `javascript-typescript,java`                 | Comma-separated CodeQL language keys |
| `code-paths`        | `**/*.js,**/*.ts,**/*.jsx,**/*.tsx,**/*.java`| Globs used for presence and PR-diff checks |
| `build-mode`        | `autobuild`                                  | `autobuild` \| `manual` |
| `manual-build-script` | `""`                                       | Shell snippet executed when `build-mode=manual` |
| `schedule-cron`     | `0 3 * * 1`                                  | Weekly run (UTC) |
| `run-on-pr`         | `true`                                       | Enable on PRs |
| `run-on-push`       | `true`                                       | Enable on pushes |

**Permissions:** The job grants `security-events: write` for SARIF uploads.

---

## 3) Reusable Workflow (Org Governance Repo)

Create **`BrikByte-Studios/.github/.github/workflows/reusable/codeql.yml`**, then tag a release **`v1`**.

```yaml
name: reusable-codeql
on:
  workflow_call:
    inputs:
      languages:            { type: string, default: 'javascript-typescript,java' }
      code-paths:           { type: string, default: '**/*.js,**/*.ts,**/*.jsx,**/*.tsx,**/*.java' }
      build-mode:           { type: string, default: 'autobuild' }   # autobuild | manual
      manual-build-script:  { type: string, default: '' }            # used when build-mode=manual
      schedule-cron:        { type: string, default: '0 3 * * 1' }
      run-on-pr:            { type: boolean, default: true }
      run-on-push:          { type: boolean, default: true }

permissions:
  contents: read
  security-events: write

jobs:
  codeql:
    name: codeql
    runs-on: ubuntu-latest
    timeout-minutes: 30
    if: >
      (inputs.run-on-push && github.event_name == 'push') ||
      (inputs.run-on-pr && github.event_name == 'pull_request') ||
      (github.event_name == 'schedule')
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }

      - name: Decide if code paths changed (PR only)
        if: github.event_name == 'pull_request'
        id: diff
        run: |
          IFS=',' read -ra GLOBS <<< "${{ inputs.code-paths }}"
          git fetch origin ${{ github.base_ref }} --depth=2 || true
          CHANGED=$(git diff --name-only origin/${{ github.base_ref }}... | tr -d '\r' || true)
          HIT=0
          for g in "${GLOBS[@]}"; do
            echo "$CHANGED" | grep -E "^${g//\*/.*}$" >/dev/null 2>&1 && HIT=1 && break
          done
          echo "changed=$HIT" >> "$GITHUB_OUTPUT"

      - name: Detect code presence (push/schedule or PR)
        id: detect
        run: |
          IFS=',' read -ra GLOBS <<< "${{ inputs.code-paths }}"
          FOUND=0
          for g in "${GLOBS[@]}"; do
            ls $g >/dev/null 2>&1 && FOUND=1 && break
          done
          echo "present=$FOUND" >> "$GITHUB_OUTPUT"

      - name: Short-circuit (no code / no relevant changes)
        if: |
          steps.detect.outputs.present == '0' ||
          (github.event_name == 'pull_request' && steps.diff.outputs.changed == '0')
        run: |
          echo "No relevant code detected; skipping CodeQL." >> $GITHUB_STEP_SUMMARY
          exit 0

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ inputs.languages }}

      - name: Autobuild (if enabled)
        if: inputs.build-mode == 'autobuild'
        uses: github/codeql-action/autobuild@v3

      - name: Manual build (if requested)
        if: inputs.build-mode == 'manual'
        shell: bash
        run: |
          set -e
          [ -n "${{ inputs.manual-build-script }}" ] || { echo "manual-build-script is empty"; exit 1; }
          bash -eo pipefail -c "${{ inputs.manual-build-script }}"

      - name: Analyze
        uses: github/codeql-action/analyze@v3
        with:
          category: '/language:${{ inputs.languages }}'

      - name: Summary
        if: always()
        run: |
          echo "### CodeQL Summary" >> $GITHUB_STEP_SUMMARY
          echo "- Languages: \`${{ inputs.languages }}\`" >> $GITHUB_STEP_SUMMARY
          echo "- Build mode: \`${{ inputs.build-mode }}\`" >> $GITHUB_STEP_SUMMARY
          echo "- Code present: ${{ steps.detect.outputs.present }}" >> $GITHUB_STEP_SUMMARY

schedule:
  - cron: ${{ inputs.schedule-cron }}
```
**Tagging:** Use semver-ish tags (e.g., `v1`, `v2`). Consumers reference stable tags, not `main`.

---
## 4) Thin Per-Repo Wrapper
Add `.github/workflows/codeql.yml` in a product repo:

```yaml
name: CodeQL
on:
  push:        { branches: [main] }
  pull_request:{ branches: [main] }
  schedule:    [ { cron: '0 3 * * 1' } ]

jobs:
  scan:
    uses: BrikByte-Studios/.github/.github/workflows/reusable/codeql.yml@v1
    with:
      languages: 'javascript-typescript,java'
      code-paths: '**/*.js,**/*.ts,**/*.jsx,**/*.tsx,**/*.java'
      build-mode: 'autobuild'
      # For complex builds:
      # build-mode: 'manual'
      # manual-build-script: |
      #   npm ci && npm run build && npm test --silent
      #   # or: mvn -q -B -DskipITs=false test
```
**Monorepo tips:**
  - Narrow `code-paths` (e.g., `services/app1/**.ts`) to reduce noise and speed runs.
  - Manual builds can target subprojects (e.g., `mvn -pl :service-a -am test`).

---
## 5) Verification Plan
- **Code repo (JS/TS or Java):**
  - Open a PR with code changes under `code-paths`.
  - Expect **SARIF upload** and **alerts** in *Security → Code scanning alerts*.
- **Non-code repo / doc-only PR:**
  - Job short-circuits; summary shows “No relevant code detected”.
- **Manual build path:**
  - Set `build-mode=manual` and provide a working script; analysis should complete.

- **Permissions:** Confirm `security-events: write` is present in the run permissions.

---
## 6) Troubleshooting
- **No alerts appear:** Check repo visibility and Security settings; ensure the action completed “Analyze” without errors.
- **Autobuild fails:** Switch to `build-mode=manual` with the project’s canonical build/test commands.
- **PR doesn’t trigger CodeQL:** Ensure files changed match `code-paths` globs.
- **Large monorepo slowness:** Narrow `code-paths` to relevant service directories.

---
## 7) Change Management
- Keep breaking changes behind new tags (`v2`, `v3`).
- Document input changes in the governance repo `CHANGELOG.md`.
- Consider org-wide default wrapper with repo-level overrides for special cases.

---

## 8) Appendix — Example Manual Build Scripts
**Node (workspace aware):**
```bash
npm ci --prefer-offline --no-audit --no-fund
npm run build --workspaces || true
npm test --silent || true
```
**Maven (unit tests only):**
```bash
mvn -q -B -DskipITs=true test
```

**Gradle (JUnit, disable integration tests):**
```bash
chmod +x gradlew
./gradlew --no-daemon test -x integrationTest
```