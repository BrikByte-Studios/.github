---
id: "ADR-0001"                # e.g. ADR-0003 (4-digit padded)
seq: 1                        # integer, matches filename prefix
title: "Central Policy Definition"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-17              # YYYY-MM-DD
review_after: null

authors:
  - "@Brikbyte-Studios/platform-lead"

area:
  - "PIPE"
  - "GOV"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "PIPE-GOV-7.1 Policy Schema & Baseline Policy"
    url: "https://github.com/BrikByte-Studios/.github/tree/main/docs/policy"
  - type: "doc"
    label: "GOV-ADR-005 — ADR System & Governance"
    url: "https://github.com/BrikByte-Studios/.github/tree/main/docs/adr"
  - type: "doc"
    label: "GitHub Branch Protection & Rulesets"
    url: "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-protected-branches"
---

# Central Policy Definition

## Status

- **Status:** Proposed  
- **Date:** 2025-11-17  
- **Review After:** n/a  
- **Authors:** @Brikbyte-Studios/platform-lead  
- **Area:** PIPE, GOV  
- **Supersedes:** none  
- **Superseded By:** none  

---

## 1. Context

BrikByte Studios is standardising CI/CD, governance, and auditability across multiple products (TeleMedEase, Light & Salt, etc.) using BrikByteOS Pipelines and the `.github` org governance spine.

Today, governance rules are:

- **Fragmented**  
  - Some rules live in GitHub branch protection settings and rulesets.  
  - Others are implicit in GitHub Actions workflows, CODEOWNERS, or undocumented team habits.  
  - Thresholds (coverage, SAST/SCA, docs expectations) are often copied by hand per repo.

- **Not machine-readable**  
  - There is no single, structured model that CI agents, policy gates, or external tools can evaluate.  
  - Audits require manually correlating branch rules, workflow configs, and test/security outputs.

- **Hard to reason about at scale**  
  - As BrikByte adds more repos, teams, and verticals, policy drift becomes likely.  
  - It is difficult to answer “What is our current minimum coverage?” or “What security thresholds do we enforce?” across all repos.

- **Weakly connected to BrikByteOS Pipelines**  
  - BrikByteOS Pipelines wants to implement policy gates (coverage, SAST/SCA thresholds, docs/ADR checks, supply-chain requirements).  
  - Without a central policy model, each pipeline pack would have to hard-code assumptions or duplicate configuration.

Architectural and organizational constraints:

- GitHub is the **primary VCS and CI provider**.
- `.github` is designated as the **canonical governance repo** for org-level rules, shared workflows, and policy-as-code.
- BrikByteOS Pipelines, ObservabilityOps, and ComplianceOps expect a **stable contract** for policy so they can implement:
  - Policy gates (PIPE-POLICY-015)  
  - Audit bundles (`.audit/`)  
  - RTM/traceability (GOV-RTM-004)

What changed now:

- BrikByteOS Pipelines is being formalised with pipeline packs, ADR tooling, and policy gates.  
- Governance ADRs (e.g., GOV-ADR-005) define **what** needs to be governed, but we now need a concrete, **machine-readable model** for **how** policy is expressed and enforced.  
- Early customers (internal teams) and future external users need a consistent way to understand and override policy while staying within controlled bounds.

Therefore, we need a **central, versioned, JSON-Schema-backed `.github/policy.yml`** that acts as the **single source of truth** for governance policy across the org.

---

## 2. Decision

We will introduce a **central policy model** in the `.github` repo and treat it as the canonical source of truth for governance, implemented as follows:

1. **Define a canonical policy schema**

   - Create `docs/policy/policy.schema.json` in `BrikByte-Studios/.github` as the **only supported structure** for governance policies.
   - Use JSON Schema (draft-07) to describe:
     - `policy_version` (semver string)  
     - `mode` (`advisory | enforce`)  
     - `reviews` (required approvals, CODEOWNER requirements, optional extra reviewer teams)  
     - `tests` (minimum coverage, require tests green, critical-path flag)  
     - `security` (SAST/SCA/DAST thresholds)  
     - `docs` (docs required on feature changes, doc path patterns)  
     - `supply_chain` (signed artifacts, SBOM requirements).

2. **Ship an org-level baseline policy**

   - Add `.github/policy.yml` in the `.github` repo that conforms to `policy.schema.json` and expresses BrikByte’s **baseline** governance posture, for example:
     - 2 approvals, CODEOWNER required on protected branches.  
     - 80% coverage baseline (with an org-wide hard minimum of 50% enforced by linting).  
     - SAST/SCA/DAST thresholds that disallow high/critical vulns on protected branches.  
     - Docs required on feature changes for specified paths.  
     - Supply chain requirements (signed artifacts, SBOM).

3. **Implement a reusable validator**

   - Implement `scripts/policy/policy-validate.js` to:
     - Parse `policy.yml` as YAML → JSON.  
     - Validate against `docs/policy/policy.schema.json` using Ajv.  
     - Apply additional lint rules (e.g., `tests.coverage_min >= 50`).  
     - Emit GitHub Actions annotations on failure and exit non-zero on violations.

4. **Expose a reusable CI workflow**

   - Add `.github/workflows/policy-lint.yml` as a **reusable workflow** (`workflow_call`) that:
     - Checks out the repo.  
     - Sets up Node.  
     - Runs `scripts/policy/policy-validate.js` with:
       - `--schema docs/policy/policy.schema.json`  
       - `--file <policy_path>` (default `.github/policy.yml`).
   - Product repos can call it via:
     ```yaml
     jobs:
       policy:
         uses: BrikByte-Studios/.github/.github/workflows/policy-lint.yml@main
         with:
           policy_path: ".github/policy.yml"
     ```

5. **Support repo-level overrides with constraints**

   - Product repos MAY define their own `.github/policy.yml`, **but**:
     - They MUST conform to `docs/policy/policy.schema.json`.  
     - They MUST NOT weaken baseline safety requirements enforced by lint (e.g., coverage < 50%).  
     - They SHOULD be **at least as strict** as the org-level policy for production-facing services.

6. **Document versioning and modes**

   - `docs/policy/README.md` and `docs/policy/versioning.md` explain:
     - Semantics of `policy_version` (MAJOR/MINOR/PATCH).  
     - How `mode` (`advisory` vs `enforce`) influences how downstream policy gates behave.  
     - Expectations for how and when product teams update to newer `policy_version` values.

Rationale:

- This decision gives BrikByteOS Pipelines, ComplianceOps, ObservabilityOps, and future tooling a **single, contract-stable model** for governance.
- It keeps policy:
  - Git-native  
  - Machine-readable  
  - Auditable  
  - Reusable across repos and pipelines

---

## 3. Alternatives Considered

Below are the options evaluated.

At least **one rejected** and **one chosen** option are included.

---

### 3.1 Option A — Free-form per-repo policy (Confluence/Markdown)

**Description:**  
Each repo/team documents governance rules in Confluence pages or free-form Markdown files, without a central schema. CI and tooling rely on convention, not a strict contract.

**Pros:**  
- Very low initial effort.  
- Teams can express nuances in rich prose.  
- No upfront schema or tooling work required.

**Cons:**  
- Not machine-readable; CI cannot reliably interpret or enforce rules.  
- High risk of drift between documented policy and actual enforcement.  
- No guarantee of consistency across repos or products.  
- Difficult to support external customers of BrikByteOS Pipelines (no contract to integrate against).

**Why Rejected:**  
- Fails the BrikByte principle of **governance as code**.  
- Creates long-term audit and scaling problems.  
- Does not provide a stable contract for BrikByteOS Pipelines, ObservabilityOps, or ComplianceOps.

---

### 3.2 Option B — Policy embedded only in ADRs

**Description:**  
Express governance rules only as ADRs (like this one), with no dedicated policy schema or `.github/policy.yml`. Pipelines and tools infer intent from ADR content or are configured manually per repo.

**Pros:**  
- Strong narrative explanation for each decision.  
- All governance changes are explicitly justified and reviewed.  
- Fits well with architecture decision practices.

**Cons:**  
- ADRs are primarily human-readable; parsing intent out of Markdown for CI is brittle.  
- No single, normalized, machine-readable snapshot of “current policy”.  
- Hard to programmatically answer questions like “what’s our current SAST threshold?” without additional mapping layers.  
- Risk of conflicts between older and newer ADRs without a clear concrete policy layer.

**Why Rejected:**  
- ADRs are excellent for **explaining and justifying** policy but are not ideal as the **live, machine-readable source of truth**.  
- We need ADRs + **a concrete policy model** that CI and governance tooling can reliably consume.

---

### 3.3 Option C — Policy model inside `brik-pipe-packs` / `brik-pipe-actions` only

**Description:**  
Define the policy model and defaults in the `brik-pipe-packs` or `brik-pipe-actions` repos. `.github` remains focused on workflows and branch protections only.

**Pros:**  
- Keeps CI/CD behaviour and policy definition in the same product repos.  
- Easier to version policy alongside pipeline packs.  
- Feels natural from a “pipeline product” perspective.

**Cons:**  
- Weakens `.github`’s role as the **single governance spine**.  
- Makes policy consumption by non-pipeline users (e.g., other tooling, external integrators) more complex.  
- Risks multiple competing policy models if different packs evolve independently.  
- Harder to reason about cross-cutting org-wide policy (e.g., legal/compliance, supply-chain requirements) that is not specific to pipeline packs.

**Why Rejected:**  
- Central governance should be **org-level**, not tied to a specific technical product repo.  
- `.github` is already the canonical place for org-level policy, shared workflows, and governance docs.  
- Pipeline packs should **consume** the central policy model, not define it.

---

### 3.4 **Option D — Central `.github/policy.yml` + JSON Schema + validator (✔ Chosen)**

**Description:**  
Adopt `.github` as the canonical source of truth for governance policy, with:

- `docs/policy/policy.schema.json` — JSON Schema.  
- `.github/policy.yml` — org baseline policy.  
- `scripts/policy/policy-validate.js` — validator + linting.  
- `.github/workflows/policy-lint.yml` — reusable workflow.  
- Repo-level overrides allowed but constrained by schema and lint rules.

**Pros:**  
- Strong alignment with BrikByte governance principles (Git-native, policy-as-code, auditable).  
- Provides a **clear, versioned contract** that BrikByteOS Pipelines, ObservabilityOps, ComplianceOps, and external users can integrate with.  
- Separate concerns:
  - ADRs explain the “why”.  
  - `policy.yml` + schema encode the “what” and “how”.  
- Enables incremental rollout:
  - Start with `mode: "advisory"`.  
  - Gradually migrate critical repos to `mode: "enforce"`.

**Cons / Trade-offs:**  
- Requires initial investment to define schema, scripts, and docs.  
- Requires ongoing discipline to maintain the schema, baseline policy, and versioning.  
- Repos must explicitly adopt the reusable workflow before benefitting.

**Why Accepted:**  
- Best balance of maintainability, governance alignment, auditability, and developer experience.  
- Fits cleanly into the BrikByteOS Pipelines design (policy gates, `.audit` bundles, RTM).  
- Scales across internal and external users: the interface is simple (`policy.yml` + `policy-lint.yml`), but the internals can evolve behind the contract.

---

## 4. Consequences

### Positive

- **Single Source of Truth:**  
  `.github/policy.yml` (backed by `policy.schema.json`) becomes the canonical representation of BrikByte governance policy.

- **Machine-readable Governance:**  
  CI pipelines, policy gates, and future governance agents can reliably evaluate policy without scraping docs or ADRs.

- **Better Auditability:**  
  Evidence for “what we require” (policy) and “what happened” (CI runs, `.audit/` bundles) becomes consistent and traceable.

- **Reusability Across Products:**  
  All BrikByteOS Pipelines packs, ObservabilityOps dashboards, and ComplianceOps exports can plug into a single policy contract.

- **Clear Contract for External Users:**  
  External adopters of BrikByteOS can decide either to:
  - Use the baseline policy as-is, or  
  - Provide their own `policy.yml` adhering to the same schema.

### Negative / Risks

- **Migration Cost:**  
  Existing repos may have implicit or ad-hoc governance rules that must be encoded into `policy.yml` and aligned with the schema.

- **Potential Drift:**  
  There is a risk that GitHub branch protection settings / rulesets diverge from the declared policy if not systematically wired (that’s work for PIPE-POLICY-015 / Rulesets automation).

- **Learning Curve:**  
  Engineers must learn how to read and update `policy.yml`, as well as how to respond to policy-lint failures.

- **Versioning Complexity:**  
  Changes to `policy.schema.json` and `policy_version` need to be communicated and rolled out carefully to avoid breaking consumer repos.

### Mitigations

- **Training & Documentation:**  
  Provide clear docs (`docs/policy/README.md`, `versioning.md`) and short examples for teams. Include training in BrikByteOS onboarding.

- **Progressive Enforcement:**  
  Start with `mode: "advisory"` and non-blocking checks for most repos, then gradually move critical services to `mode: "enforce"` once pipelines and teams are ready.

- **Automated Checks & Observability:**  
  Use `policy-lint.yml` in PRs touching `.github/policy.yml` or workflow files. Later, connect policy evaluation results into ObservabilityOps dashboards.

- **Future Ruleset Automation:**  
  Follow-up tasks (e.g., `GOV-BRANCH-003`, `PIPE-POLICY-015`) can programmatically apply GitHub rulesets that are derived from `policy.yml`, reducing drift risk.

---

## 5. Implementation Notes

- **Repository and Files:**
  - Repo: `BrikByte-Studios/.github`
  - Schema: `docs/policy/policy.schema.json`
  - Baseline policy: `.github/policy.yml`
  - Validator script: `scripts/policy/policy-validate.js`
  - Reusable workflow: `.github/workflows/policy-lint.yml`
  - Docs: 
    - `docs/policy/README.md` (overview, usage)  
    - `docs/policy/versioning.md` (semver and upgrade process)

- **Validator Responsibilities:**
  - Uses Ajv to enforce `policy.schema.json`.  
  - Emits GitHub Actions annotations on schema or lint violations.  
  - Enforces a minimal safety rule: `tests.coverage_min >= 50`.  
  - Future: may enforce additional baseline security or docs rules.

- **Consumer Pattern:**
  - Product repo defines `.github/policy.yml` (optionally; inherits schema and baseline).  
  - Product repo configures:
    ```yaml
    jobs:
      policy:
        uses: BrikByte-Studios/.github/.github/workflows/policy-lint.yml@main
        with:
          policy_path: ".github/policy.yml"
    ```
  - CI then validates policy on PRs that touch `.github/policy.yml` or workflows.

- **Interaction with Other Systems:**
  - BrikByteOS Pipelines: policy gate jobs will later **read and interpret** `policy.yml` to set test/security/docs thresholds.  
  - ObservabilityOps: can expose dashboards for policy adoption, violations, and trends.  
  - ComplianceOps: can use `policy.yml` and corresponding `.audit/` artefacts to answer audit questions (“What was the policy at time of deployment X?”).

- **Review & Governance:**
  - Changes to `policy.schema.json` or `.github/policy.yml` should be:
    - Proposed via PR.  
    - Reviewed by Platform Lead, relevant Eng Managers, and Security/Compliance when applicable.  
    - Accompanied by a `policy_version` bump and a short changelog.

---

## 6. References

- BrikByteOS Pipelines Product Brief (PIPE)  
- GOV-ADR-005 — ADR System & Governance Tooling  
- PIPE-GOV-7.1 — Implement central `.github/policy.yml` governance  
- `docs/policy/policy.schema.json` in `BrikByte-Studios/.github`  
- GitHub Docs — Branch protection & rulesets  
- Future: PIPE-POLICY-015 — Policy Gate Consumption in Pipeline Packs
