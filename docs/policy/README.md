# BrikByte Studios — Org Governance Policy (`.github/policy.yml`)

This directory defines the **canonical governance policy contract** for BrikByte Studios.

The goal is to make **“what is our policy?”**:

- **Git-native** — versioned alongside code in `.github`
- **Machine-readable** — enforced via JSON Schema + CI
- **Auditable** — easy to trace at audit-time
- **Reusable** — for BrikByteOS Pipelines, ObservabilityOps, ComplianceOps, and external users

---

## 1. Files in this Directory

```text
docs/policy/
├── policy.schema.json   # JSON Schema for policy.yml (single source of truth for structure)
├── README.md            # This file – how the policy system works
└── versioning.md        # Semver rules and upgrade expectations for `policy_version`
```

Elsewhere in the `.github` repo:
```text
.github/
  policy.yml                    # Org-level baseline policy (PIPE-GOV-7.1)
.github/workflows/
  policy-lint.yml               # Reusable workflow to validate policy.yml (GOV-POLICY-001)
scripts/policy/
  policy-validate.js            # Node-based validator + lint rules
```

---

## 2. What is `.github/policy.yml`?

`.github/policy.yml` is the **single source of truth** for BrikByte’s governance model.
It encodes policy in a **structured, machine-readable** way so CI and tools can enforce it.

It defines:

- **Reviews**
    - Required approvals count
    - Whether CODEOWNER review is mandatory
    - Optional additional reviewer teams

- **Tests**
    - Minimum coverage percentage
    - Whether tests must be green
    - Whether coverage applies only to critical paths

- **Security**
    - SAST / SCA / DAST thresholds (e.g. “no high”, “no critical” vulnerabilities)

- **Docs**
    - Whether feature changes must include docs / ADR updates
    - Which paths count as “docs”

- **Supply Chain**
    - Whether artifacts must be signed
    - Whether SBOMs are required

The **org baseline** lives in this `.github` repo, and individual product repos may define their own `policy.yml` **within the same schema and constraints**.

---

## 3. Policy Schema Overview

The canonical schema is in [policy.schema.json](./policy.schema.json).
.  
At a high level:
```json
{
  "version": 1,                  // Schema version (integer, governance-owned)
  "policy_version": "1.0.0",     // Policy version (semver, X.Y.Z)
  "mode": "advisory",            // "advisory" | "enforce"

  "reviews": {
    "required_approvals": 2,
    "require_code_owner_review": true,
    "additional_reviewer_teams": ["platform-leads"]
  },

  "tests": {
    "coverage_min": 80,
    "require_tests_green": true,
    "critical_paths_only": false
  },

  "security": {
    "sast_threshold": "no-high",     // "none" | "no-high" | "no-critical"
    "sca_threshold": "no-critical",
    "dast_threshold": "no-critical"
  },

  "docs": {
    "require_docs_on_feature_change": true,
    "paths": ["docs/**", "docs/adr/**", "adr/**"]
  },

  "supply_chain": {
    "require_signed_artifacts": true,
    "require_sbom": true
  }
}
```

Key points:

- `version`
    - Integer describing **schema version**, controlled by governance.
    - Not usually modified by product teams.

- `policy_version`
    - Semver (X.Y.Z) describing policy content.
    - See [versioning.md](./versioning.md) for how changes are managed.

- `mode`
    - `advisory` → policy violations are reported but may not yet block merges.
    - `enforce` → intended to back hard policy gates (PIPE-POLICY-015).

For full field definitions, see [policy.schema.json](./policy.schema.json).


---

## 4. Org Baseline Policy

The baseline org policy lives at:
```text
.github/policy.yml
```

Example (simplified):
```yaml
version: 1
policy_version: "1.0.0"
mode: "advisory"

reviews:
  required_approvals: 2
  require_code_owner_review: true
  additional_reviewer_teams:
    - "platform-leads"

tests:
  coverage_min: 80
  require_tests_green: true
  critical_paths_only: false

security:
  sast_threshold: "no-high"
  sca_threshold: "no-critical"
  dast_threshold: "no-critical"

docs:
  require_docs_on_feature_change: true
  paths:
    - "docs/**"
    - "adr/**"
    - "docs/adr/**"

supply_chain:
  require_signed_artifacts: true
  require_sbom: true
```

**Baseline vs. safety floor**
- The validator (`policy-validate.js`) enforces a safety floor:
    - `tests.coverage_min` **must be ≥ 50** (org minimum).

- Teams are encouraged to be **stricter than the baseline**, not weaker:
    - e.g., coverage 90+ for critical services.

---

## 5. Validation: `policy-validate.js` + `policy-lint.yml`
### 5.1 Local Validation (from `.github` repo root)
```bash
# Validate org-level policy
node scripts/policy/policy-validate.js \
  --schema docs/policy/policy.schema.json \
  --file .github/policy.yml
```

The validator:
1. Parses the policy YAML (`--file`).
2. Validates against `policy.schema.json` via Ajv.
3. Runs **extra lint rules**, including:
    - `tests.coverage_min >= 50`
4. Emits **GitHub Actions annotations** on failure and exits with non-zero status.

### 5.2 Reusable CI Workflow

The reusable workflow lives in:
```text
.github/workflows/policy-lint.yml
```

It is designed to be called via `workflow_call` from other repos.

In a **consumer repo**, you might add:
```yaml
# .github/workflows/policy.yml (in product repo)
name: Policy Validate

on:
  pull_request:
    paths:
      - ".github/policy.yml"
      - ".github/workflows/**"

jobs:
  policy:
    uses: BrikByte-Studios/.github/.github/workflows/policy-lint.yml@main
    with:
      policy_path: ".github/policy.yml"
```

This will:
- Check out the repo
- Install Node deps
- Run `scripts/policy/policy-validate.js` (from `.github` repo) against the product’s `.github/policy.yml`
- Block merges if the policy is invalid or weakens safety thresholds

---

## 6. How Product Repos Consume / Override Policy
### 6.1 Minimal Integration (Validation Only)

If a product repo wants **just schema validation** for its own policy:

1. **Create a local policy file** in that repo:
```bash
cp path/to/BrikByte-Studios/.github/.github/policy.yml .github/policy.yml
# Then edit for local needs (stricter coverage, extra teams, etc.)
```

2. **Add the reusable workflow call**:
```yaml
# .github/workflows/policy.yml
name: Policy Validate

on:
  pull_request:
    paths:
      - ".github/policy.yml"
      - ".github/workflows/**"

jobs:
  policy:
    uses: BrikByte-Studios/.github/.github/workflows/policy-lint.yml@main
    with:
      policy_path: ".github/policy.yml"
```

3. **Open a PR**. Any invalid or unsafe changes in `policy.yml` will be flagged by CI.

### 6.2 No Local Policy (Yet)
If a repo **does not** define its own `.github/policy.yml`:
- It can **still be governed indirectly** by:
    - Org-level rulesets & branch protection (GOV-BRANCH work).
    - BrikByteOS pipeline packs that reference the **org baseline**.

- It simply won’t have repo-specific policy validation until it adds `.github/policy.yml`.

---

## 7. Baseline vs. Overrides

**Org-level baseline (`BrikByte-Studios/.github`):**
- Defines the **default** governance posture for the org.
- Should be aligned with:
    - Internal risk appetite
    - Security/compliance expectations
    - BrikByteOS Pipelines’ default gates

**Repo-level overrides (product repos):**
- May:
    - Tighten thresholds (e.g., coverage 90, stricter SAST/SCA).
    - Add extra reviewer teams.
    - Tailor docs paths to their folder structure.

- Must **not**:
    - Violate schema constraints.
    - Weaken enforced safety floors (e.g., coverage below 50).
    - Bypass security or supply-chain expectations where flagged as mandatory in lint rules (this may expand in future versions).

In other words:

**Repos can be stricter than the baseline, but not fundamentally looser on core safety controls**.

---

## 8. Versioning & policy_version

Policy content changes are tracked via the policy_version field.

Examples:
```yaml
policy_version: "1.0.0"  # initial baseline
policy_version: "1.1.0"  # new optional fields, advisory checks
policy_version: "2.0.0"  # breaking changes in semantics or minimums
```

See [versioning.md](./versioning.md) for:
- **MAJOR/MINOR/PATCH** semantics
- Upgrade expectations for product teams
- How policy changes are proposed, reviewed, and rolled out

---

## 9. How This Connects to BrikByteOS Pipelines

This policy model is intentionally **product-agnostic** but designed to plug into:

- **BrikByteOS Pipelines**
    - Pipeline packs will read `policy.yml` to:
        - Set coverage thresholds
        - Enforce SAST/SCA/DAST gates
        - Ensure docs/ADR updates on certain changes
    - Future task `PIPE-POLICY-015` will make these policy gates first-class.

- **ObservabilityOps**
    - Can surface dashboards showing:
        - Policy adoption
        - Policy violations over time
        - Distribution of coverage thresholds, security thresholds, etc.

- **ComplianceOps**
    - Can bundle:
        -Effective policy at time T (`policy.yml` + `policy_version`)
        - CI evidence and `.audit/` bundles
    - Useful for ISO 27001 / SOC2 / POPIA-style audits.

---
## 10.  Governance & Change Process

Changes to:
- `docs/policy/policy.schema.json`
- `.github/policy.yml`
- `scripts/policy/policy-validate.js`
- `.github/workflows/policy-lint.yml`

should:

1. Be proposed via PR in the `.github` repo.
2. Include:
    - Updated files
    - A `policy_version` bump (if policy semantics change)
    - Notes in the PR description (what changed, impact).

3. Be reviewed by:
- Platform Lead (governance)
- Relevant Engineering Manager(s)
- Security / Compliance (for security-critical changes)

Once merged:
- The org baseline policy is updated.
- Product repos can adopt the new `policy_version` as they update.
- Tooling (BrikByteOS Pipelines, ObservabilityOps, ComplianceOps) can rely on the updated contract.

---

## 11. Quick Checklist for New Repos
When onboarding a new repo to BrikByte governance:

1. **Decide if you need a local `.github/policy.yml`**
- If **yes**:
    - Copy baseline from `BrikByte-Studios/.github/.github/policy.yml`
    - Adjust fields (usually stricter, not looser)
    - Add `policy-lint.yml` usage as shown above
- If no:
    - You still inherit org-wide rulesets and pipeline packs; revisit later.

2. **Run validation locally (optional but recommended):**
```bash
node scripts/policy/policy-validate.js \
  --schema docs/policy/policy.schema.json \
  --file .github/policy.yml
```

3. **Open a PR** and ensure:
- `policy-lint` job is green.
- Governance reviewers have approved.