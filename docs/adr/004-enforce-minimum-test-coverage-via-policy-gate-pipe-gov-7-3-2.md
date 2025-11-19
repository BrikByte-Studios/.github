---
id: "ADR-0004"                # e.g. ADR-0003 (4-digit padded)
seq: 4                        # integer, matches filename prefix
title: "Enforce minimum test coverage via policy gate (PIPE-GOV-7.3.2)"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-19              # YYYY-MM-DD
review_after: 2026-05-17

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "PIPE"
  - "GOV"
  - "QA"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Enforce minimum test coverage via policy gate (PIPE-GOV-7.3.2)

## Status

- **Status:** Proposed  
- **Date:** 2025-11-19  
- **Review After:** 2026-05-17  
- **Authors:** @BrikByte-Studios/platform-leads  
- **Area:** PIPE, GOV, QA  
- **Supersedes:** none  
- **Superseded By:** none  

---

## 1. Context

### Problem statement

Across BrikByte repos, automated test coverage is:

- **Inconsistent** — some services enforce coverage, others do not.
- **Opaque** — coverage levels are visible only in HTML reports or CI logs, not as a structured, queryable signal.
- **Not policy-driven** — coverage thresholds are defined per-repo (if at all), not centrally governed via `.github/policy.yml`.
- **Weakly auditable** — auditors and governance cannot easily answer:
  - “What minimum coverage do we require?”
  - “Did this release meet the coverage bar?”
  - “Where is the evidence for that claim?”

This creates risk that:

- Critical services ship with **declining** or **insufficient** coverage.
- Coverage regressions slip through during refactors.
- There is no uniform, audit-ready trail that ties coverage expectations to policy, tests, and releases.

### Architectural / organizational constraints

- BrikByteOS Pipelines already standardizes CI via **policy-as-code** (`.github/policy.yml`) and **decision.json** exports.
- Policy versioning and repo-level overrides are defined in:
  - **PIPE-GOV-7.1** — central policy schema and baseline.
  - **PIPE-GOV-7.2** — repo-level overrides via `extends`.
- We must avoid **CI logic drift**:
  - Coverage enforcement logic must live in **shared governance tooling** (scripts + workflows), not bespoke per repo.
- Different tech stacks produce different coverage formats, but we need a **common contract**:
  - “Effective line/statement coverage as a percentage” is the minimal cross-language signal.

### What changed / why now

- BrikByteOS Pipelines is establishing a **unified policy gate** for governance (security, reviews, coverage, docs).
- Governance workstreams (PIPE-GOV-7.x) require that:
  - **Coverage expectations** are explicitly codified.
  - CI gates are **deterministic** and **auditable**.
- Several in-flight products (CargoPulse, TeleMedEase, internal tools) are ramping up:
  - We want to **lock in healthy coverage habits** before the ecosystem grows further.
- Upcoming compliance and customer requirements (ISO-style evidence) need:
  - **Structured JSON evidence** per release, not manually-assembled screenshots.

### Related decisions / debt

- **ADR-0001 — Central Policy Definition** defines `.github/policy.yml` as the governance source of truth.
- **ADR-0002 — Repo-level policy overrides via extends** defines how org-level policy can be safely tightened per repo.
- **ADR-0003 — Node-based governance tooling** (assumed) defines shared gate architecture and `decision.json` export.

This ADR focuses specifically on **minimum test coverage** as a first-class, policy-driven gate in that architecture.

---

## 2. Decision

### Decision statement

We will:

1. **Define test coverage expectations in `.github/policy.yml`** under a `tests` section, including:
   - `coverage_min`: absolute minimum coverage percentage.
   - `coverage_delta_min`: allowed drop vs a defined baseline (in percentage points).
   - `coverage_report_path`: path to a machine-readable coverage summary (e.g., Jest/Istanbul `coverage-summary.json`).

2. **Implement a shared coverage gate** (`scripts/policy/coverage-gate.js`) that:
   - Reads the **merged effective policy** (org + repo overrides).
   - Loads the **coverage summary JSON** from CI artifacts.
   - Computes current coverage and (optionally) delta vs baseline.
   - Evaluates coverage against:
     - **Org-level baseline** (non-relaxable).
     - **Repo-level tightening** (allowed).
     - Optional **delta threshold**.
   - Writes results into `decision.json.coverage` and fails CI when thresholds are not met.

3. **Integrate coverage enforcement into governance pipeline(s)** so that:
   - Coverage failures **block merges** when policy `mode: enforce`.
   - Coverage violations are **logged and visible** even in advisory mode.
   - `.audit/.../decision.json` contains coverage evidence for each gated run.

### Rationale

- **Policy-driven, not ad hoc**  
  Moving coverage rules into `.github/policy.yml` aligns with our policy-as-code strategy:
  - One schema, one baseline, controlled by governance.
  - Repos can **tighten** rules (increase coverage) but cannot quietly weaken them.

- **Deterministic CI behavior**  
  Coverage enforcement is implemented as:
  - A **single shared gate script**.
  - Driven by an **explicit contract** (`tests` policy section).
  This avoids each repo reinventing coverage checks.

- **Auditability and RTM**  
  By exporting coverage results into `decision.json` and `.audit` bundles, we can:
  - Prove that a given release respected coverage thresholds.
  - Link governance requirements (REQ-COV-*) to implementation and tests via RTM.

- **Extensible pattern for other metrics**  
  The pattern (policy → metric parsing → evaluation → decision.json) can later be reused for:
  - SAST/SCA thresholds.
  - Quality scores.
  - Performance budgets, etc.

### Alignment with BrikByte principles

- **Git-native** — Policy lives in repo, changes are reviewed via PR, CI gates run in GitHub Actions.
- **Audit-ready** — Outputs structured `decision.json` under `.audit/`.
- **Deterministic** — Given the same policy + coverage report, the gate always yields the same result.
- **Opinionated but flexible** — Org-level baselines are enforced, while repos can raise the bar.

---

## 3. Alternatives Considered

### 3.1 Option A — Per-repo custom coverage scripts

Each repo defines its own coverage threshold and enforcement logic in bespoke CI steps.

**Pros:**  
- Maximum flexibility per repo.  
- Teams can pick any format or strategy.

**Cons:**  
- Fragmented: inconsistent behavior across repos.  
- No central visibility into coverage standards.  
- Hard to audit or reason about at org level.  
- High maintenance burden; logic duplicated N times.

**Why Rejected:**  
- Violates the **governance-as-a-product** principle of BrikByteOS Pipelines.  
- Does not provide org-wide guarantees or auditability.

---

### 3.2 Option B — Coverage as “badge only” (non-blocking)

Coverage is reported (e.g., badges or dashboards), but CI never blocks on low coverage.

**Pros:**  
- Zero friction for teams.  
- No risk of coverage-related CI failures.

**Cons:**  
- No **enforcement**; coverage can decay over time.  
- Encourages ignoring coverage regressions under delivery pressure.  
- Provides weak assurance for auditors and customers.

**Why Rejected:**  
- Fails the governance requirement that coverage act as a **hard constraint** for critical branches.  
- Not compatible with risk posture for production services.

---

### 3.3 Option C — Fixed global coverage threshold in CI (no policy)

Implement a hardcoded coverage threshold (e.g., 80%) in CI scripts, outside of `.github/policy.yml`.

**Pros:**  
- Simple to implement initially.  
- Consistent across repos that adopt the script.

**Cons:**  
- Threshold not visible or versioned in policy.  
- Hard to support different coverage expectations by product type (libs vs apps).  
- No clear story for repo-level tightening or per-product experimentation.  
- Drift between script behavior and written governance policy.

**Why Rejected:**  
- Breaks the single-source-of-truth model for governance.  
- Couples CI logic to a magic number rather than a structured policy object.

---

### 3.4 **Option D — Policy-driven coverage gate with decision.json (✔ Chosen)**

Coverage expectations are defined in `.github/policy.yml` and evaluated by a shared coverage gate that writes structured evidence into `decision.json`.

**Pros:**  
- Strong alignment with existing **policy-as-code** architecture.  
- Central baseline + per-repo tightening supported via `extends`.  
- Deterministic CI behavior and clear, human-readable failure messages.  
- Audit-ready evidence per run (coverage numbers + policy thresholds).  
- Reusable pattern for other quantitative gates.

**Cons / Trade-offs:**  
- Requires initial investment in:
  - Schema updates.
  - Gate implementation.
  - Coverage report normalization.  
- Requires onboarding for teams to:
  - Produce coverage JSON.
  - Understand `coverage_min` and `coverage_delta_min`.

**Why Accepted:**  
- Best balance of **governance alignment**, **developer experience**, and **auditability**.  
- Fits naturally into BrikByteOS Pipelines’ shared gate + `.audit` strategy.  
- Scales to multi-product, multi-repo environments without drift.

---

## 4. Consequences

### Positive

- **Standardization of coverage expectations**  
  - Every participating repo follows the same structural contract for coverage rules.
  - Coverage becomes a well-defined, versioned part of governance.

- **Enforced quality bar**  
  - Minimum coverage is guaranteed for protected branches that enable the gate.
  - Regressions below baseline are detectable and blockable.

- **Improved auditability and RTM**  
  - Coverage evidence is captured in `decision.json` and `.audit/...`.
  - Easier to answer questions from auditors or leadership:
    - “Did we meet coverage policy for this release?”
    - “How did coverage change over time?”

- **Encourages better test discipline**  
  - Teams are nudged to maintain or improve coverage.
  - Regression risk is reduced for refactors and new features.

### Negative / Risks

- **Migration cost**  
  - Repos without existing coverage may need:
    - Test harness setup.
    - Coverage configuration.
    - Pipeline instrumentation.

- **Initial friction**  
  - Early adoption may cause PRs to fail until coverage is raised or tests are fixed.
  - Misconfigured `coverage_report_path` may cause confusing failures.

- **Format assumptions**  
  - Relying initially on a specific coverage JSON format (e.g., Jest/Istanbul) may:
    - Require adapters for other ecosystems.
    - Cause issues if the structure does not match expectations.

### Mitigations

- **Phased rollout (advisory → enforce)**  
  - Start with `mode: advisory` and log coverage failures without blocking.
  - Switch to `mode: enforce` per repo once coverage is stable.

- **Good defaults & documentation**  
  - Provide sample `coverage-summary.json` and documented expectations.
  - Offer copy-paste CI snippets for common stacks (Node, Python, etc.).

- **Configurable paths**  
  - `coverage_report_path` lives in policy, not hardcoded in gate.
  - Future-proof with potential for field-path configuration (e.g., `tests.coverage_field_path`).

- **Error clarity**  
  - Gate emits explicit messages for:
    - Missing coverage file.
    - Parse errors.
    - Coverage below threshold.
    - Delta violations.

---

## 5. Implementation Notes

> These notes guide implementation tasks like PIPE-GOV-7.3.2 and related work.

### Policy & schema

- Extend `docs/policy/policy.schema.json`:

  - Ensure `tests` section includes:
    - `coverage_min` (0–100).
    - `coverage_delta_min` (optional, numeric, in percentage points).
    - `coverage_report_path` (string).
  - Update examples in:
    - `.github/policy.yml`.
    - `docs/policy/coverage.md`.

- Example policy snippet:

  ```yaml
  tests:
    coverage_min: 80
    coverage_delta_min: -2
    coverage_report_path: "coverage/coverage-summary.json"
  ```

### Gate implementation
- Implement `scripts/policy/coverage-gate.js`:
  - Inputs (CLI flags):
    - `--org-policy` — path to org policy (`.github/policy.yml`).
    - `--effective-policy` — merged policy JSON (org + repo).
    - `--coverage-report` — path to coverage summary JSON.
    - `--decision-in` / `--decision-out` — decision.json path (in-place update).

  - Responsibilities:
    1. Load **org** and **effective** policy:
         - Determine org baseline `coverage_min_org`.
         - Determine repo override `coverage_min_repo` (if any).
         - Set `coverage_min_effective = max(org, repo)` to enforce non-relaxable baseline.
    2. Read coverage JSON from `coverage_report_path`:
         - For v1, assume Istanbul/Jest structure:
           - `total.lines.pct` as primary metric.
    3. Optionally load baseline coverage (for delta) from:
         - Prior decision.json (e.g., main branch), or
         - Separate baseline artifact (implementation detail).
    4. Evaluate:
         - If `coverage_current < coverage_min_effective` → fail.
         - If baseline present and `coverage_delta_min` defined:
           - `delta = coverage_current - coverage_baseline`.
           - If `delta < coverage_delta_min` → fail.
    5. Update `decision.json.coverage` with:
        - `coverage_current`
        - `coverage_baseline` (if available)
        - `coverage_min`
        - `coverage_delta_min`
        - `delta`
        - `coverage_report_path`
        - `result: "pass" | "fail"`
        - `reason`

- Example CI usage (inside a policy gate workflow):
```yaml
- name: Coverage Gate
  run: >
    node scripts/policy/coverage-gate.js
    --org-policy .github/policy.yml
    --effective-policy out/effective-policy.json
    --coverage-report coverage/coverage-summary.json
    --decision-in .audit/decision.json
    --decision-out .audit/decision.json
```
### Audit integration
- Ensure gate is invoked **after** coverage report generation but **before** `.audit` bundling step.
- The `.audit/.../decision.json` produced for the run should already include `coverage` section when exported.

### Ownership & rollout
- Platform/Governance team owns:
  - Policy schema fields and baseline thresholds.
  - Gate implementation and maintenance.
  - Documentation and training materials.

- Product teams own:
  - Producing coverage reports in CI.
  - Raising coverage to meet thresholds.
  - Managing repo-level tightening when desired.

---

## 6. References
- **Internal / ADRs**
  - ADR-0001 — Central Policy Definition.
  - ADR-0002 — Repo-level policy overrides via `extends`.
  - ADR-0003 — Node-based governance tooling & policy gate architecture.
  - Task: PIPE-GOV-7.3.2 — Enforce minimum test coverage via policy gate.

- **Policy & governance docs**
  - `.github/policy.yml` — org baseline policy.
  - `docs/policy/README.md` — policy overview.
  - `docs/policy/coverage.md` — coverage governance standard (to be created/updated).

- **External**
  - Jest / Istanbul coverage summary format (`coverage-summary.json`).
  - General testing & coverage best practices (language/framework-specific docs).




