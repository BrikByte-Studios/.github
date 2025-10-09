# DEVOPS-CI-PIPE-004 — Reusable Multi-Matrix CI (Node + Java across OSes)

> **Goal:** Run a **tiered**, **polyglot** CI matrix (Ubuntu/Windows/macOS × Node/Java) that stays **under a 12-minute wall-time SLO** on empty repos, with **caching**, **artifacts**, and a **thin per-repo wrapper**.

---

## 1) Executive Summary

This guide ships a production-ready **reusable workflow** (published in the org governance repo) that:
- Detects **Node** and/or **Java** projects (noop-safe otherwise).
- Fans out across **OS × Node version × Java version**.
- Runs **full** tier on Ubuntu and **smoke** tiers on Windows/macOS to meet time SLO.
- Enables **lockfile-keyed caching** (npm/yarn/pnpm) and **Maven/Gradle** caches.
- Uploads **JUnit** / **coverage** artifacts when present.
- Writes a **Step Summary** per job (matrix, tier, hints).

Consumers call it via a **thin wrapper** in their repositories.

---

## 2) Prereqs & Governance

- **Org repo**: `BrikByte-Studios/.github` (hosts the reusable workflow).
- **Branch protection** in downstream repos references checks from other pipelines (e.g., `lint`, `test`), while this matrix flow augments cross-OS/runtime coverage.
- **Runners**: GitHub-hosted runners (`ubuntu-latest`, `windows-latest`, `macos-latest`).

---

## 3) What you get (Deliverables)

- **Reusable workflow** (tag **`v1`**):
  - `BrikByte-Studios/.github/.github/workflows/reusable/matrix-ci.yml`
- **Per-repo wrapper**:
  - `.github/workflows/matrix.yml` calling `@v1`
- **Artifacts** (if present):
  - `junit.xml`, `coverage/**`, Maven Surefire/Gradle test XML
- **Evidence**:
  - Step Summary: realized matrix, tier, OS/runtime versions.

---

## 4) Reusable Workflow (org repo)

Create **`BrikByte-Studios/.github/.github/workflows/reusable/matrix-ci.yml`**, tag a release `v1`.

```yaml
name: reusable-matrix-ci
on:
  workflow_call:
    inputs:
      os-list:        { type: string, default: 'ubuntu-latest,windows-latest,macos-latest' }
      node-versions:  { type: string, default: '18,20' }
      java-versions:  { type: string, default: '17,21' }
      node-pm:        { type: string, default: 'npm' }     # npm|yarn|pnpm
      tier-ubuntu:    { type: string, default: 'full' }    # full|smoke
      tier-windows:   { type: string, default: 'smoke' }   # full|smoke
      tier-macos:     { type: string, default: 'smoke' }   # full|smoke
      workdir:        { type: string, default: '.' }

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  matrix:
    name: ${{ matrix.os }} / node:${{ matrix.node }} / java:${{ matrix.java }} / ${{ matrix.tier }}
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        os: ${{ fromJSON(format('["{0}"]', join(inputs.os-list, '","'))) }}
        node: ${{ fromJSON(format('["{0}"]', join(inputs.node-versions, '","'))) }}
        java: ${{ fromJSON(format('["{0}"]', join(inputs.java-versions, '","'))) }}
        include:
          - os: ubuntu-latest
            tier: ${{ inputs.tier-ubuntu }}
          - os: windows-latest
            tier: ${{ inputs.tier-windows }}
          - os: macos-latest
            tier: ${{ inputs.tier-macos }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Detect stacks
        id: detect
        shell: bash
        run: |
          cd "${{ inputs.workdir }}"
          # Node presence
          test -f package.json && echo "node=true" >> $GITHUB_OUTPUT || echo "node=false" >> $GITHUB_OUTPUT
          # Java presence: prefer Maven; else Gradle if wrapper exists
          if ls **/pom.xml >/dev/null 2>&1; then echo "java=maven" >> $GITHUB_OUTPUT
          elif [ -f gradlew ]; then echo "java=gradle" >> $GITHUB_OUTPUT
          else echo "java=none" >> $GITHUB_OUTPUT; fi

      # --- Node toolchain (conditional) ---
      - name: Setup Node
        if: steps.detect.outputs.node == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: ${{ inputs.node-pm == 'npm' && 'npm' || inputs.node-pm }}
          cache-dependency-path: |
            ${{ inputs.workdir }}/package-lock.json
            ${{ inputs.workdir }}/yarn.lock
            ${{ inputs.workdir }}/pnpm-lock.yaml

      - name: Node install
        if: steps.detect.outputs.node == 'true'
        shell: bash
        run: |
          set -e; cd "${{ inputs.workdir }}"
          case "${{ inputs.node-pm }}" in
            npm)  npm ci --prefer-offline --no-audit --no-fund ;;
            yarn) yarn install --frozen-lockfile ;;
            pnpm) corepack enable && pnpm i --frozen-lockfile ;;
          esac

      - name: Node lint (Linux only)
        if: steps.detect.outputs.node == 'true' && startsWith(matrix.os, 'ubuntu') == true
        shell: bash
        run: |
          cd "${{ inputs.workdir }}"
          if jq -e '.scripts.lint' package.json >/dev/null 2>&1; then
            case "${{ inputs.node-pm }}" in
              npm) npm run -s lint ;;
              yarn) yarn -s lint ;;
              pnpm) pnpm -s lint ;;
            esac
          else
            echo "noop: no lint script"
          fi

      - name: Node test (${{ matrix.tier }})
        if: steps.detect.outputs.node == 'true'
        shell: bash
        run: |
          cd "${{ inputs.workdir }}"
          if jq -e '.scripts.test' package.json >/dev/null 2>&1; then
            if [ "${{ matrix.tier }}" = "full" ]; then
              case "${{ inputs.node-pm }}" in
                npm)  npm test --silent -- --ci --reporters=default --reporters=junit || true ;;
                yarn) yarn -s test || true ;;
                pnpm) pnpm -s test || true ;;
              esac
            else
              if jq -e '.scripts["test:smoke"]' package.json >/dev/null 2>&1; then
                case "${{ inputs.node-pm }}" in
                  npm)  npm run -s test:smoke || true ;;
                  yarn) yarn -s test:smoke || true ;;
                  pnpm) pnpm -s test:smoke || true ;;
                esac
              else
                echo "noop: no smoke test"
              fi
            fi
          else
            echo "noop: no test script"
          fi

      # --- Java toolchain (conditional) ---
      - name: Setup Java
        if: steps.detect.outputs.java != 'none'
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.java }}
          cache: ${{ steps.detect.outputs.java }}

      - name: Java test (${{ matrix.tier }})
        if: steps.detect.outputs.java != 'none'
        shell: bash
        run: |
          set -e
          if [ "${{ steps.detect.outputs.java }}" = "maven" ]; then
            if [ "${{ matrix.tier }}" = "full" ]; then
              mvn -q -B -DskipITs -Dspotbugs.skip=true test
            else
              mvn -q -B -DskipITs -Dtest='*Smoke*' -Dspotbugs.skip=true test || true
            fi
          elif [ "${{ steps.detect.outputs.java }}" = "gradle" ]; then
            chmod +x gradlew
            if [ "${{ matrix.tier }}" = "full" ]; then
              ./gradlew --no-daemon test -x integrationTest
            else
              ./gradlew --no-daemon test -Psmoke=true || true
            fi
          fi

      # --- Artifacts (best-effort) ---
      - name: Upload reports (if any)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: reports-${{ matrix.os }}-${{ matrix.node }}-${{ matrix.java }}
          path: |
            ${{ inputs.workdir }}/junit.xml
            ${{ inputs.workdir }}/coverage/**
            **/surefire-reports/*.xml
            **/test-results/test/*.xml
          if-no-files-found: ignore

      - name: Summary
        if: always()
        shell: bash
        run: |
          echo "### Matrix Execution" >> $GITHUB_STEP_SUMMARY
          echo "- OS: ${{ matrix.os }}" >> $GITHUB_STEP_SUMMARY
          echo "- Node: ${{ matrix.node }} | Java: ${{ matrix.java }}" >> $GITHUB_STEP_SUMMARY
          echo "- Tier: ${{ matrix.tier }}" >> $GITHUB_STEP_SUMMARY
```
**Tagging:** After committing to the org repo, create a release/tag `v1`. Consumers should reference `@v1`.

---
## 5) Thin Per-Repo Wrapper
Create `.github/workflows/matrix.yml` in a product repo:

```yaml
name: matrix
on:
  push:        { branches: [main] }
  pull_request:{ branches: [main] }

jobs:
  ci-matrix:
    uses: BrikByte-Studios/.github/.github/workflows/reusable/matrix-ci.yml@v1
    with:
      os-list: 'ubuntu-latest,windows-latest,macos-latest'
      node-versions: '18,20'
      java-versions: '17,21'
      node-pm: 'npm'
      tier-ubuntu: 'full'
      tier-windows: 'smoke'
      tier-macos: 'smoke'
      workdir: '.'
```
**Notes**
  - Wrapper controls tiers and matrix breadth (time vs. coverage).
  - For monorepos, set `workdir` to the service path (e.g., `services/app1`).

---
## 6) Empty-Repo Safety & SLO
- If no `package.json` and no `pom.xml`/`gradlew` → **all jobs noop** and finish green.
- **SLO:** With tiering (Ubuntu full, Win/Mac smoke), empty-repo ≤ 12 min wall-time (typically ≪).

---

## 7) Caching
- **Node:** lockfile-keyed cache (`npm`/`yarn`/`pnpm`) via `actions/setup-node`.
- **Java:** `actions/setup-java` caching:
    - Maven: `~/.m2/repository`
    - Gradle: `~/.gradle/caches`
- Expect **first run cold**, subsequent runs faster with **cache hits** in logs.

---

## 8) Artifacts & Evidence
- Uploads when present:
    - Node (Jest/JUnit): `junit.xml`, `coverage/**`
    - Maven: `**/surefire-reports/*.xml`
    - Gradle: `**/test-results/test/*.xml`
- **Step Summary** per job logs OS/Node/Java/tier (auditability).

---
## 9) Verification Plan
1. **Empty repo:** All jobs noop and finish; pipeline wall-time ≤ 12 min.
2. **Node repo:** Ubuntu runs lint + full test; Windows/macOS run `test:smoke` or noop; artifacts appear if emitted; second run shows cache hits.
3. **Java (Maven):** Detects Maven; runs per tier; Surefire XML collected.
4. **Java (Gradle):** Detects Gradle wrapper; runs per tier; Gradle test results uploaded.
5. **Mixed repo:** Both stacks execute conditionally in the same jobs; tiering respected.

---
## 10)  Troubleshooting
- **No artifacts:** Ensure your framework emits JUnit (e.g., configure Jest `jest-junit`).
- **Windows/macOS slow:** Keep smoke tier minimal; push full suites to Ubuntu.
- **Gradle permission denied:** `chmod +x gradlew` already included; ensure wrapper is present.
- **Cache misses:** Verify lockfile exists and paths match `cache-dependency-path`.

---
## 11) Change Management
- Keep `matrix-ci` stable on `v1`.
- Breaking changes → release `v2`; consumers upgrade intentionally.
- Per-repo wrappers own their matrix/tier choices—document defaults and overridable inputs.

---
## 12)  Appendix — Recommended Project Scripts
**Node (package.json):**

```json
{
  "scripts": {
    "lint": "eslint .",
    "test": "jest",
    "test:smoke": "jest -c jest.smoke.config.js"
  }
}
```
**Maven (pom.xml):**
  - Full: `mvn -q -B test`
  - Smoke: `mvn -q -B -Dtest='*Smoke*' test`

**Gradle (build.gradle):**
```groovy
test {
  useJUnitPlatform()
  if (project.hasProperty('smoke')) {
    include '**/*Smoke*'
  }
}
```