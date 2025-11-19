---
id: "ADR-0006"                # e.g. ADR-0003 (4-digit padded)
seq: 6                        # integer, matches filename prefix
title: "Enforce ADR & documentation checks via policy gate (PIPE-GOV-7.3.4)"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-19              # YYYY-MM-DD
review_after: 2026-05-17

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "PIPE"
  - "GOV"
  - "ARCH"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Enforce ADR & documentation checks via policy gate (PIPE-GOV-7.3.4)

## Status

- **Status:** Proposed
- **Date:** 2025-11-19
- **Review After:** 2026-05-17
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** PIPE, GOV, ARCH
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByte Studios is standardizing on “policy-as-code” and ADR-driven decision making for architecture, infrastructure, security, and governance (GOV-ADR-005, PIPE-GOV-7.x).  

However, today:

- Significant infra / pipeline / security changes can land without a corresponding ADR.
- Existing ADRs are sometimes:
  - Missing required front-matter fields (status, area, date, etc.).
  - Not clearly linked to the PRs that implement them.
  - Left in **Proposed** state while code is already merged and running in production.
- There is no **automatic, policy-driven** control that:
  - Detects when “high-impact paths” were touched (e.g. `infra/**`, `.github/**`, `security/**`, `charts/**`).
  - Requires an ADR reference when those areas change.
  - Validates that the ADR itself is structurally correct and in the right status (e.g. **Accepted**).

Architectural / organizational constraints:

- Governance, audit, and RTM (traceability) require:
  - A consistent, machine-readable ADR schema (`adr.schema.json`) and validator (`adr-lint.js`).
  - Evidence that infra / architecture decisions are deliberate, reviewed, and recorded.
  - A gate that can be rolled out **incrementally** (advisory → enforce) across repos.
- The gate must:
  - Run inside CI (GitHub Actions).
  - Be **policy-driven** via `.github/policy.yml` rather than hardcoded logic.
  - Integrate with the existing decision.json + `.audit/...` evidence model defined in GOV-ADR-005.

What changed *now*:

- PIPE-GOV-7.1 and 7.2 established a central policy schema and repo-level overrides.
- PIPE-GOV-7.3.1–7.3.3 added gates for reviews, coverage, and security.
- Without ADR checks, BrikByte still has a gap: we can enforce “how” code is merged (approvals, coverage, security), but not **“why”** it changed at an architectural level.
- Upcoming compliance and customer expectations (audit-ready traceability, SOC2/ISO-style controls) require provable links between high-impact changes and ADRs.

Therefore, we need a **branch-agnostic, path-based ADR gate** that:

- Detects when ADRs are required.
- Ensures referenced ADRs are valid and in the correct lifecycle state.
- Records all ADR decisions and evidence into decision.json and `.audit` bundles.

---

## 2. Decision

We will:

1. **Extend `.github/policy.yml` with an `adr` section** that defines:
   - `adr.required_on_paths`: globs of paths that require ADRs when changed.
   - `adr.require_accepted_adr`: whether an ADR must be in **Accepted** status.
   - `adr.adr_file_glob`: where ADR files live (e.g. `docs/adr/[0-9][0-9][0-9]-*.md`).

2. **Integrate ADR checks into the governance gate** so that, for each PR:
   - CI (via `gather`):
     - Fetches the list of changed files from the GitHub API.
     - Matches them against `adr.required_on_paths`.
     - Sets `adr_required: true` and records which paths triggered the requirement.
   - CI (via `eval`):
     - If `adr_required`:
       - Parses the PR title/body for ADR IDs (e.g. `ADR-0007`).
       - Verifies that the referenced ADR file(s) exist under `adr_file_glob`.
       - Validates ADRs using `adr-lint.js` and `adr.schema.json`.
       - If `require_accepted_adr: true`, ensures ADR `status` is **Accepted**.
     - Fails the gate when:
       - No ADR is referenced.
       - Referenced ADR is missing, malformed, or in an invalid status.
       - ADR validation fails (schema issues).

3. **Write ADR evidence into decision.json**, under a structured `adr` section:
   - `adr_required` (boolean).
   - `triggered_paths` (list of changed files that required ADR).
   - `adr_referenced_ids` and mapped filenames.
   - `adr_validation_result` and any `schema_issues`.
   - `result` and `reason` (pass / fail / fail_waived).
   - `waivers` if applicable (rule-scoped ADR waivers).

4. **Integrate with GOV-ADR-005 and adr-validate.yml**:
   - Reuse the canonical ADR template and schema.
   - Treat `adr-lint.js` as the single source for ADR validation rules.
   - Ensure the gate only passes if ADRs touched or referenced by the PR are lint-clean.

Rationale:

- **Trade-offs**
  - Adds some friction to high-impact changes (infra / .github / security / charts), but significantly increases governance quality.
  - Requires teams to maintain ADR discipline (status transitions, correct front-matter), but this improves long-term clarity and onboarding.
- **Why this option**
  - Policy-driven: repos opt into standard behavior and can adjust globs sensibly while staying within schema.
  - Git-native: uses PRs, ADR files in the repo, and CI-based gates instead of external tools.
  - Reusable: ADR gate can be consumed by any repo that adopts BrikByte governance pipelines.
- **Supporting data**
  - Prior incidents and “stealth” infra changes without ADRs are hard to reconstruct post hoc.
  - Customers and auditors frequently ask for architecture decision history and traceability.
- **Alignment with BrikByte principles**
  - Git-native governance.
  - Deterministic, audit-ready CI gates.
  - Traceable architecture decisions (REQ ↔ ADR ↔ code changes ↔ tests).

---

## 3. Alternatives Considered

### 3.1 Option A — “Manual ADR discipline only”

**Pros:**  
- Zero engineering effort.  
- No changes required in CI or policy.  
- Teams can adopt ADR practices organically.

**Cons:**  
- No enforcement; relies entirely on culture and memory.  
- Inconsistent adoption across teams and repos.  
- No machine-readable evidence for audits or RTM.  
- High risk of “big changes with no ADR” slipping into main.

**Why Rejected:**  
- Fails governance and audit requirements for policy-as-code and traceability.  
- Conflicts with BrikByte’s goal of deterministic, policy-driven gates.

---

### 3.2 Option B — “Lightweight ADR linter only (no path rules)”

**Pros:**  
- Ensures ADRs that exist are well-formed (schema-valid).  
- Lower implementation complexity than a full gate.  
- Can be run as a simple workflow (`adr-validate.yml`) on ADR changes.

**Cons:**  
- Does **not** ensure that ADRs exist when high-impact areas change.  
- No connection between code changes and ADRs; still possible to bypass ADRs entirely.  
- Limited value for RTM and compliance (you know ADRs are valid if they exist, but not that they cover all significant changes).

**Why Rejected:**  
- Only solves half the problem (ADR quality, not ADR **requirement**).  
- Still leaves a major gap: code can change without any ADR linkage.

---

### 3.3 Option C — “Central ADR registry service outside Git / CI”

**Pros:**  
- Could provide a fancy UI, advanced search, and analytics.  
- Decouples ADR storage / lifecycle from Git constraints.

**Cons:**  
- Violates Git-native, repo-local principle.  
- Adds an external dependency and infra footprint for core governance.  
- Makes local development and offline workflows harder.  
- Requires additional integration and synchronization complexity (Git ↔ registry).

**Why Rejected:**  
- Overkill for the current phase (foundation).  
- Misaligned with BrikByte’s design of keeping governance in Git + CI + YAML.

---

### 3.4 **Option D — Policy-driven, path-based ADR gate in CI (✔ Chosen)**

**Pros:**  
- Strong alignment with policy-as-code and GOV-ADR-005.  
- Automatically enforces ADR requirements for high-impact paths.  
- Uses a single ADR schema + linter across the org.  
- Produces deterministic, machine-readable evidence in decision.json and `.audit`.  
- Works across all repos that adopt BrikByte governance pipelines.

**Cons / Trade-offs:**  
- Requires teams to update PR descriptions and ADR statuses consistently.  
- Some onboarding and education needed about:
  - When an ADR is required.
  - How to reference ADR IDs in PRs.
  - How to handle superseded ADRs.

**Why Accepted:**  
- Best balance between governance strength and developer experience.  
- Scales with the organization while remaining transparent and predictable.  
- Enables traceable, reviewable architecture decision history tied directly to code changes.

---

## 4. Consequences

### Positive

- **Standardization**  
  - Common ADR template, schema, and validation across BrikByte.  
  - Consistent rule: “certain paths → ADR required.”

- **Governance alignment**  
  - Directly supports GOV-ADR-005 and PIPE-GOV-7.x policy-as-code initiatives.  
  - Makes infra / security / pipeline changes auditable and explainable.

- **Reduced long-term complexity**  
  - Clear history of architecture decisions and their implementing PRs.  
  - Easier onboarding for new engineers (“read ADRs instead of diffing years of Git history”).

- **Audit-ready evidence**  
  - decision.json and `.audit/...` capture ADR-related decisions and waivers.

### Negative / Risks

- **Migration cost**  
  - Existing repos may need:
    - Initial ADR backlog (retro ADRs for key systems).
    - Adjustments to directory layout, path globs, or ADR statuses.

- **Training required**  
  - Engineers need to learn:
    - How to write ADRs in the canonical template.
    - How to reference ADR IDs in PR descriptions.
    - When a change is “big enough” to warrant an ADR (policy guidance needed).

- **Possible breakage / friction**  
  - Early misconfiguration (overly broad globs) could block trivial changes.  
  - Old ADRs might fail schema validation until cleaned up.

### Mitigations

- **Training plan**  
  - Short “ADR 101” and “How the ADR gate works” documentation and brown-bag sessions.  
  - Concrete examples of PR descriptions with ADR references.

- **Progressive rollout**  
  - Start with `mode: advisory` for ADR gate:
    - Log failures, add comments, but don’t block merges yet.
  - Move to `mode: enforce` per repo/branch once patterns are stable.

- **Compatibility / scope tuning**  
  - Iterate on `adr.required_on_paths` globs to avoid over-matching.  
  - Allow narrowly scoped waivers for low-risk changes (e.g., cosmetic `.github` tweaks).  
  - Provide a playbook for bringing legacy ADRs up to schema.

---

## 5. Implementation Notes

- **Policy changes**
  - Extend `docs/policy/policy.schema.json` with an `adr` block:
    - `required_on_paths: string[]`
    - `require_accepted_adr: boolean`
    - `adr_file_glob: string`
  - Add example `adr` section to `.github/policy.yml` seeded with:
    - `infra/**`, `.github/**`, `charts/**`, `security/**`.

- **Gather step (`gather.mjs`)**
  - Use GitHub API to:
    - Retrieve PR metadata (number, title, body).
    - List changed files for the PR.
  - Glob-match changed files against `adr.required_on_paths`.
  - Output:
    - `adr_required: boolean`
    - `adr_triggered_paths: string[]`
    - `pr_body`, `pr_title` (for ADR ID extraction).

- **Eval step (`eval-adr.mjs`)**
  - If `adr_required`:
    - Extract ADR IDs from PR title/body using `/ADR-\d{4}/g`.
    - For each ID:
      - Resolve filename under `adr_file_glob`.
      - Ensure file exists.
      - Ensure status is `Accepted` if required.
      - Run `adr-lint.js` (or reuse its API) for schema validation.
  - Populate `decision.adr` with:
    - `adr_required`, `triggered_paths`, `adr_referenced_ids`.
    - `adr_validation_result` (pass / fail / partial).
    - `schema_issues` (if any).
    - `result` & `reason`.
    - `waivers` (if rule-level waiver applied, e.g. `rule: "adr.required"`).

- **Integration**
  - Hook ADR evaluation into the main governance gate workflow alongside:
    - Reviews, coverage, security checks.
  - Ensure `.audit/<date>/PIPE-GOV-7.3.4/decision.json` is written or symlinked from the main decision.json, per GOV-ADR-005.

- **Ownership**
  - Platform / Governance team owns:
    - Policy schema, ADR template, and gate behavior.
    - Default `required_on_paths` and example usage.
  - Product teams own:
    - Writing ADRs for their changes.
    - Referencing ADR IDs correctly in PRs.

---

## 6. References

- GOV-ADR-005 — ADR index, template & validation system  
- PIPE-GOV-7.1 / 7.2 — Central policy + repo-level overrides  
- PIPE-GOV-7.3.x — Reviews, Coverage, Security gates  
- BrikByte ADR template and `adr.schema.json`  
