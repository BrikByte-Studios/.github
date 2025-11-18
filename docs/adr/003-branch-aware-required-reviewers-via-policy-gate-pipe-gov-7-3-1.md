---
id: "ADR-0003"                # e.g. ADR-0003 (4-digit padded)
seq: 3                        # integer, matches filename prefix
title: "Branch-aware required reviewers via policy gate (PIPE-GOV-7.3.1)"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-18              # YYYY-MM-DD
review_after: 2026-05-18

authors:
  - "@BrikByte-Studios/platform-leads"
  - "@thapelomagqazana"

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

# Branch-aware required reviewers via policy gate (PIPE-GOV-7.3.1)

## Status

- **Status:** Proposed
- **Date:** 2025-11-18
- **Review After:** 2026-05-18
- **Authors:** @BrikByte-Studios/platform-leads, @thapelomagqazana
- **Area:** PIPE, GOV
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

### Problem

BrikByteOS Pipelines is moving governance for CI/CD into **policy-as-code** (`.github/policy.yml`) so that security, quality, and change-control rules are:

- Centralized and auditable  
- Enforced consistently across repos  
- Traceable into RTM, test packs, and audit bundles  

However, **review / approval rules** are currently enforced primarily by:

- GitHub branch protection and “required reviewers” settings  
- Per-repo conventions and social norms (“we usually want 2 approvals on main”)  

This leads to issues:

1. **Inconsistent enforcement**

   - Different repos configure different required-approval rules in the GitHub UI.  
   - High-risk branches (e.g. `main`, `release/*`, `hotfix/*`) may not consistently enforce the same level of scrutiny.

2. **Lack of policy-as-code**

   - Approval rules are not expressed in `.github/policy.yml` or covered by the central policy schema.  
   - There is no single, versioned, reviewable source of truth for:
     - Required approvals per branch type  
     - Required roles/teams (e.g. `platform-leads` on `hotfix/*`)  
     - Whether CODEOWNER review is mandatory  

3. **Weak audit evidence**

   - Evidence that the right people approved a change is spread across GitHub UI and activity logs.  
   - Audit bundles do not contain a structured **reviews decision** explaining why a gate passed or failed.

4. **Non-relaxable org minimums**

   - Org-level expectations (e.g. “`main` and `release/*` always require ≥2 approvals”) are not enforced centrally.  
   - Repo admins can unintentionally weaken approval rules via UI changes.

Governance requires **branch-aware, policy-driven required reviewers**, enforced in CI via a **policy gate** with structured evidence persisted into `decision.json`.

### Constraints & background

- Central policy is defined in `.github/policy.yml` with a canonical JSON Schema (`docs/policy/policy.schema.json`) per ADR-0001.  
- Repo-level overrides use `extends: org` semantics and policy-merge rules per ADR-0002.  
- Policy gates (reviews, coverage, security, docs, etc.) run in CI and write machine-readable decision bundles for `.audit/`.  
- Implementation runs as Node helpers inside GitHub Actions, using `GITHUB_TOKEN` with REST/GraphQL APIs.

### Why now

- PIPE-GOV-7.1 and 7.2 already established **central policy** and **repo overrides**.  
- BrikByteOS Pipelines is rolling out to production-facing repos where deployment risk is directly tied to review quality.  
- Governance and compliance stakeholders require **repeatable evidence** of approvals for ISO/SOC2/POPIA-style audits and internal controls.

---

## 2. Decision

### Decision statement

We will:

1. **Extend `.github/policy.yml` and `policy.schema.json`** to define a **branch-aware `reviews` section** with:

   - `reviews.default` → default approval rule.  
   - `reviews.branches` → rules keyed by branch/glob patterns (e.g. `main`, `release/*`, `hotfix/*`, `feature/*`).  
   - Fields including:
     - `required_approvals`  
     - `require_code_owner_review`  
     - `required_roles` (e.g. `["platform-leads"]`)

2. **Implement a CI policy gate for reviews** that:

   - Detects the **target branch** of a PR.  
   - Resolves the applicable rule (exact branch match, then glob, falling back to `default`).  
   - Uses a **gather step** to query the GitHub API for:
     - Approving reviewers and their team memberships  
     - CODEOWNER approval status (where applicable)  
   - Evaluates actual approvals against policy:
     - `actual_approvals >= required_approvals`  
     - `code_owner_approved` if `require_code_owner_review: true`  
     - At least one approver in each `required_roles` team

3. **Enforce non-relaxable org minimums** via the gate:

   - For org-designated protected branches (e.g. `main`, `release/*`), repo-level overrides may tighten but **not relax**:
     - `required_approvals`  
     - security posture (if later tied into review rules)  
   - “Equal or stricter is allowed; weaker is rejected” is the invariant.

4. **Emit structured evidence in `decision.json`** under a `reviews` key:

   ```jsonc
   "reviews": {
     "branch": "main",
     "required_approvals": 2,
     "actual_approvals": 1,
     "require_code_owner_review": true,
     "code_owner_approved": false,
     "required_roles": ["platform-leads"],
     "actual_roles": ["backend-team"],
     "result": "fail",
     "reason": "Branch main requires 2 approvals; got 1."
   }
   ```
5. **Document review governance** in `docs/policy/reviews.md` and reference it from the main policy docs.

### Rationale
- **Policy-as-code instead of panel-as-code**  
Review rules should live in versioned, reviewable YAML (`.github/policy.yml` + schema), not only hidden inside GitHub UI.

- **Branch-aware risk control**  
Different branches have different risk profiles; BrikByteOS needs a first-class way to encode this (e.g. stricter rules on `main`/`release/*`/`hotfix/*`, lighter on `feature/*`).

- **Auditability**  
A structured `decision.json.reviews` entry is significantly easier to audit than piecing evidence together from PR timelines.

- **Alignment with BrikByte architecture principles**
  - Git-native and GitHub-native
  - Audit-ready via `.audit` bundles
  - Deterministic and reproducible guardrails
  - Extensible to other gates (coverage, SAST/SCA, artifact integrity)
---

## 3. Alternatives Considered

---

### 3.1 Option A — Only use GitHub branch protection & required reviewers
**Pros:**  
- Zero custom code.
- Simple to configure via GitHub UI.
- Fully supported by GitHub.

**Cons:**  
- Rules are **not expressed in policy-as-code** and cannot be version-controlled alongside code.
- Inconsistent across repos; no central enforcement or visibility.
- Limited expressiveness for role/team-based requirements per branch.
- No direct integration with BrikByteOS decision bundles and `.audit`.

**Why Rejected:**  
- Does not meet the governance requirement for central, auditable, policy-driven review rules.

---

### 3.2 Option B — Let each repo script its own approval gate
**Pros:**  
- High flexibility for individual teams.
- No central schema constraints.

**Cons:**  
- Fragmented implementations, duplicated bugs, and inconsistent behavior.
- High maintenance burden.
- Difficult to guarantee org-wide minimums or consistent audit output

**Why Rejected:**  
- Conflicts with the BrikByteOS goal of **standardized governance tooling**.
- Increases long-term operational and cognitive load.

---

### 3.3 Option C — Central GitHub Rulesets, but no CI policy gate
**Pros:**  
- Use GitHub’s native Rulesets and branch protection at org level.
- Less custom code compared to a full gate.

**Cons:**  
- Limited ability to express complex role/branch logic in a portable way.
- Evidence still fragmented across GitHub UI and logs.
- Does not integrate naturally with `.audit` bundles and RTM.

**Why Rejected:**  
- Only partially solves centralization; still lacks **unified decision bundles** and policy-as-code semantics.

---

### 3.4 **Option D — Policy-driven CI gate for required reviewers (✔ Chosen)**
**Pros:**  
- Single source of truth in `.github/policy.yml` for review rules.
- Branch-aware and role-aware with clear merge semantics.
- Deterministic CI behavior with explicit pass/fail reasons.
- Structured evidence for audits in `decision.json`.
- Reusable across all BrikByteOS Pipelines repos.

**Cons / Trade-offs:**  
- Requires implementation and maintenance of Node-based gather/eval logic.
- More moving parts (API calls, permissions, possible rate limits).
- Onboarding effort for teams to understand policy syntax and failure messages.  

**Why Accepted:**  
- Best balance of **governance alignment, developer experience, and auditability**.
- Integrates with existing policy and decision-bundle mechanisms (PIPE-GOV-7.x).  

---

## 4. Consequences

### Positive
- **Standardized review governance** across repos and branches.
- **Transparent expectations:** developers can read `reviews` rules in policy YAML.
- **Audit-ready reviews evidence** in `.audit` via `decision.json`.
- **Non-relaxable org minimums** enforced at the gate level, not left to UI configuration alone.
- Clear linkage between requirements (REQ-REV-), tests (TC-REV-), and gate behavior.

### Negative / Risks
- Misconfigured policies may **block merges unexpectedly**.
- Bugs in user→team mapping could cause false failures.
- Additional runtime cost and complexity in CI.
- Potential confusion if GitHub UI rules and policy gate diverge. 

### Mitigations
- Roll out initially in **advisory mode** for selected repos before enforcing.
- Provide **rich logging** and clear error messages from the gate.
- Maintain good ****unit and smoke tests** for review evaluation logic.
- Document common failure cases and resolutions (e.g., missing platform-leads approval).
- Periodically reconcile GitHub UI settings with policy defaults.

---

## 5. Implementation Notes

Extend `docs/policy/policy.schema.json` to include:
- `reviews.default.*`
- `reviews.branches.<pattern>.*`
- `required_roles` support.

Update `.github/policy.yml` with example reviews configuration for:
- `main`
- `release/*`
- `hotfix/*`
- `feature/*`

Implement:
- **Gather logic** (e.g. `scripts/policy/gather-reviews.mjs`):
  - Fetch PR metadata (base branch, reviews with `state = APPROVED`).
  - Map approvers to teams via GitHub APIs.
  - Detect CODEOWNER approval where required.
- **Eval logic** (`scripts/policy/eval-reviews.mjs`):
  - Resolve effective policy (after org+repo merge).
  - Match branch to appropriate review rule.
  - Evaluate approvals vs policy and org minimums.
  - Write a `reviews` block into `decision.json`.
  - Fail CI if `reviews.result === "fail"`.
- Document behavior and examples in `docs/policy/reviews.md`, including:
  - Schema fields.
  - Branch-specific examples.
  - How non-relaxable minimums interact with repo overrides.

Ownership:
- Platform/Governance team owns schema and gate implementation.
- Product teams own conforming to the rules and adjusting local overrides where allowed.

---

## 6. References

- ADR-0001 — Central Policy Definition
- ADR-0002 — Repo-level policy overrides via `extends`
- PIPE-GOV-7.1 — Org-level `.github/policy.yml` & schema
- PIPE-GOV-7.2 — Repo-level policy overrides via `extends`
- PIPE-GOV-7.3.1 — Required Reviewers (this ADR’s implementation task)

