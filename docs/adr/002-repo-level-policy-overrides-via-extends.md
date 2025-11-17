---
id: "ADR-0002"                # e.g. ADR-0003 (4-digit padded)
seq: 2                        # integer, matches filename prefix
title: "Repo-level policy overrides via extends"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-17              # YYYY-MM-DD
review_after: null

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "PIPE"
  - "GOV"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Repo-level policy overrides via extends

## Status

- **Status:** Proposed
- **Date:** 2025-11-17
- **Review After:** n/a
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** PIPE, GOV
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS Pipelines uses `.github/policy.yml` as the **central, org-wide governance contract** for reviews, tests, security, documentation, and supply-chain rules (see ADR-0001 “Central Policy Definition”).  

This org-level policy solves the problem of inconsistent governance across repos, but it does **not yet** provide a structured, safe way for **individual product repos** to:

- Tighten policy for their own risk profile (e.g., higher coverage, stricter SCA/SAST thresholds),
- Add repo-specific reviewer teams or documentation paths,
- Evolve at different speeds while still conforming to a single schema.

Today, repo-level “customization” tends to happen via:

- Ad-hoc GitHub branch protection rules,
- Copy-pasted YAML fragments in workflows,
- Manual conventions not enforced by CI,

…which leads to:

- Policy **drift** (each repo diverges subtly),
- Accidental **weakening** of security or coverage requirements,
- Poor **traceability** between governance decisions and actual enforcement in pipelines,
- Increased **maintenance overhead** for platform and governance teams.

We need a **formal, deterministic mechanism** that allows:

- **Inheriting** the central policy,
- **Extending** it with repo-specific additions, and
- **Overriding** some fields without weakening non-relaxable baselines,

…backed by tooling that can be called from CI and reused by pipeline packs (e.g., PIPE-POLICY-015).

At the same time, we must preserve:

- A **single canonical schema** (`docs/policy/policy.schema.json`), and
- A clear definition of what fields are **non-relaxable** (e.g., `mode`, minimum coverage, security thresholds, supply-chain flags),

so governance decisions remain auditable and explainable.

---

## 2. Decision

We will introduce **repo-level policy overrides** using an explicit **`extends`** mechanism and a deterministic merge algorithm:

> **Decision:** Repo-level `policy.yml` files may inherit from the org baseline via `extends: org`, and are merged with `.github/policy.yml` by a dedicated `policy-merge` tool, which enforces schema validity and non-relaxable constraints.

Concretely, we will:

1. **Extend the shared policy schema**  
   - Keep `docs/policy/policy.schema.json` as the canonical schema for both:
     - `.github/policy.yml` (org baseline), and
     - `policy.yml` in consumer repos.  
   - Add optional `extends: "org" | "none"`:
     - **Org policy**: SHOULD omit `extends` (implicitly base).
     - **Repo policy**: MAY specify `extends: org` (default) or, with explicit governance approval, `extends: none`.

2. **Define the repo policy shape**

   Example:

   ```yaml
   # repo-root/policy.yml
   extends: org
   policy_version: "1.0.0"

   mode: "enforce"   # allowed if org mode is "advisory"; forbidden if org is already "enforce"

   tests:
     coverage_min: 90

   reviews:
     required_approvals: 2
     additional_reviewer_teams:
       - "platform-leads"
       - "payments-team"

   security:
     sca_threshold: "no-high"
   ```
- The **same nested `reviews/tests/security/docs/supply_chain` structure** applies everywhere.
- No extra top-level fields are allowed (schema keeps `additionalProperties: false`).

3. **Implement a `policy-merge` CLI**
     - `scripts/policy/policy-merge.js`:
       - Loads **base** policy from `.github/policy.yml`,
       - Loads **repo** policy from `policy.yml`,
       - Validates against `policy.schema.json`,
       - Merges them into a single **effective policy**,
       - Runs non-relaxable **constraint checks** and fails on illegal relaxations,
       - Writes the resulting effective policy as JSON (for later consumption by policy gates).

    **Merge semantics:**
     - **Objects:** merged recursively.
     - **Scalars:** repo value wins (subject to constraints).
     - **Arrays:** union with de-duplication (e.g., reviewer teams).

4. **Enforce non-relaxable constraints**

    After merge, the tool enforces:

   - `mode`:
     - If base mode: "enforce", repo may not set mode: "advisory".

   - `tests.coverage_min`:
     - `effective.coverage_min >= base.coverage_min` must always hold.
   - `security.{sast_threshold, sca_threshold, dast_threshold}`:
     - Repo can only choose thresholds that are **equal or stricter** than base.
       - e.g., if base `sca_threshold: "no-high"`, repo cannot set `"none"` or `"no-critical"`.
   - `supply_chain.require_signed_artifacts` and `supply_chain.require_sbom`:
     - If base is `true`, repo cannot set them to `false`.

    Any violation yields a hard failure with a clear, field-specific error message.

5. **Wire CI workflows for override validation**
    - Provide `.github/workflows/policy-override-check.yml` that:
      - Validates repo `policy.yml` against the shared schema, and
      - Runs `policy-merge` to ensure constraints hold.
    - Consumer repos call this workflow via `workflow_call` on PRs that touch `policy.yml`.

6. **Document override behavior**
   - Document the semantics in `docs/policy/overrides.md`:
     - How `extends` works.
     - Which fields can be tightened vs. which cannot be relaxed.
     - Examples of good overrides and anti-patterns.

**Rationale / Alignment**
- Keeps **governance decisions centralized**, while giving teams a safe path to **tighten** policy locally.
- The merge behavior is **purely declarative** and testable, which is ideal for CI integration.
- Ensures policy-as-code remains **schema-driven and auditable**, aligning with GOV-POLICY-001 and BrikByte’s principles:
  - Git-native,
  - Audit-ready,
  - Deterministic,
  - Developer-friendly.
---

## 3. Alternatives Considered

Below are the options evaluated.

At least **one rejected** and **one chosen** option are required.

---

### 3.1 Option A — Only org-level policy (no repo overrides)
**Pros:**  
- Very simple mental model (one file, one source of truth).
- No merging or override logic required.

**Cons:**  
- Cannot handle differing risk profiles across products/services.
- Forces “weakest common denominator” policies globally or leads to out-of-band rules.
- Encourages ad-hoc exceptions (Slack agreements, manual branch rules).

**Why Rejected:**  
- Does not support the multi-product nature of BrikByteOS.
- Fails to encode legitimate stricter requirements for high-risk domains (e.g., payments, healthcare).
---

### 3.2 Option B — Copy & fork `.github/policy.yml` per repo
**Pros:**  
- Simple to start: teams copy the org policy and modify it.
- No new schema or merge tooling required.

**Cons:**  
- Creates **policy drift** almost immediately.
- Very hard to know which repos are out-of-date or misaligned.
- Increases maintenance cost for governance: no single baseline to compare against.

**Why Rejected:**  
- Violates the single source of truth goal from PIPE-GOV-7.1.
- Makes auditing and diffing policy variants extremely painful.

---

### 3.3 Option C — Inline configuration in CI workflows only
**Pros:**  
- Keeps everything “close to the pipelines” in `.github/workflows/*.yml`.
- No separate policy object to maintain.

**Cons:**  
- Governance logic is scattered across multiple workflow files.
- Hard to extract a single conceptual policy for audits or tooling.
- No clear contract for what “policy” actually is; difficult to reuse or reason about.

**Why Rejected:**  
- Conflicts with the **policy-as-code** direction and RTM aspirations (GOV-RTM-004).
- Makes it difficult to have uniform policy gates across products.

---

### 3.4 **Option D — Central baseline + repo overrides via extends (✔ Chosen)**
**Pros:**  
- Preserves `.github/policy.yml` as the canonical baseline.
- Repo-level overrides are explicit, structured, and **schema-validated**.
- Merge semantics are deterministic and testable in CI.
- Non-relaxable baselines can be enforced centrally, reducing governance risk.
- Easy to integrate into future policy gates (PIPE-POLICY-015) and observability dashboards.

**Cons / Trade-offs:**  
- Requires introducing and maintaining `policy-merge` tooling.
- Teams must learn the `extends` semantics and allowed override patterns.

**Why Accepted:**  
- Best balance between **governance alignment** and **developer autonomy**.
- Keeps policy evolution **traceable, reviewable, and audit-friendly**.
- Fits naturally with BrikByteOS’ platform-driven, Git-native governance model. 

---

## 4. Consequences

### Positive
- **Standardized override mechanism:** Every repo that needs custom behavior uses the same `policy.yml` + `extends` pattern.
- **Safe tightening**: Teams can raise coverage, add extra reviewers, or flip to `mode: enforce` without fear of accidentally weakening baselines.
- **Deterministic effective policy:** For any repo, we can compute and inspect a single effective policy object, which simplifies:
  - Policy gates in CI,
  - Governance audits,
  - Future tooling (dashboards, RTM links).
- **Clear separation of concerns:**
  - Governance defines schema + constraints,
  - Repos define their **local intent** within that guardrail.

### Negative / Risks
- **Learning curve**: Engineers must understand `extends`, merge rules, and constraints.
- **Tooling complexity**: `policy-merge` and related workflows add code that must be maintained.
- **Edge cases**: Complex future policies may require evolving the merge logic and constraints carefully. 

### Mitigations
- Provide **examples and anti-patterns** in `docs/policy/overrides.md`.
- Keep merge logic **simple and opinionated** in v1; avoid over-engineering.
- Add **smoke tests** and unit tests for `policy-merge` (inherit-only, tightening, illegal relax, unknown fields).
- Use ADR review process (e.g., GOV-ADR-005) before introducing new non-relaxable fields.

---

## 5. Implementation Notes

Implemented under `BrikByte-Studios/.github`:
- `docs/policy/policy.schema.json` extended with optional `extends`.
- `scripts/policy/policy-merge.js`:
  - Validates both base and repo policy with Ajv,
  - Merges objects/scalars/arrays,
  - Enforces constraints (mode, coverage, security, supply_chain),
  - Emits clear error messages and exits non-zero on violation.
- `docs/policy/overrides.md`:
  - Documents good override patterns and bad ones (e.g., relaxing thresholds).
- `examples/policy/repo-policy.yml`:
  - Serves as a reference override for product teams.

CI integration:
- `.github/workflows/policy-override-check.yml` reusable workflow for repos.
- Repos call this workflow from their own `.github/workflows/policy-override.yml` on PRs touching `policy.yml`.

Future work:
- PIPE-POLICY-015 will consume the effective policy to drive policy gates.
- Observability tasks (PIPE-GOV-7.3+) may surface policy variants and adoption in dashboards.

---

## 6. References

- ADR-0001 — Central Policy Definition
- GOV-ADR-005 — ADR system & governance tooling
- GOV-POLICY-001 — Policy-as-code baseline
- GOV-RTM-004 — Governance RTM & traceability
- PIPE-GOV-7.1 — Org-level .github/policy.yml & schema
- PIPE-GOV-7.2 — Repo-level policy overrides via extends (this ADR)

