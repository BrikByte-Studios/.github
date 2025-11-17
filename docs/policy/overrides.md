# BrikByte Studios — Repo-Level Policy Overrides (`extends`)

This document explains how **repo-level policies** can safely override the
org-level `.github/policy.yml` using:

- `extends: org` (recommended)
- Deterministic merge rules
- Non-relaxable constraints (you can tighten, not weaken)

It is part of **PIPE-GOV-7.2 — Repo-level policy overrides via extends**.

---

## 1. Why Repo-Level Policy Overrides?

The org baseline (`BrikByte-Studios/.github/.github/policy.yml`) defines a
**default governance posture** for the whole org.

However, some repos:

- Are **more critical** (e.g., customer-facing, payment flows)
- Need **stricter thresholds** (e.g., higher coverage)
- Have **extra reviewer teams** (e.g., security, payments)
- Have **specific doc paths** (e.g., a different docs/ layout)

Repo-level overrides allow these teams to:

> “Be stricter than the baseline, while still conforming to the same schema and
> non-relaxable guardrails.”

---

## 2. Repo Policy Shape

A repo-level `policy.yml` looks like this:

```yaml
# repo-root/policy.yml

extends: org                # or "none" with explicit governance approval
policy_version: "1.0.0"     # must conform to policy.schema.json

mode: "enforce"             # allowed if org baseline is "advisory"

tests:
  coverage_min: 90          # stricter than org 80
  require_tests_green: true

reviews:
  required_approvals: 2     # equal to org
  additional_reviewer_teams:
    - "platform-leads"
    - "payments-team"       # extends org list

security:
  sast_threshold: "no-high"         # equal/stricter
  sca_threshold: "no-high"          # tighter than org "no-critical"
  dast_threshold: "no-critical"

docs:
  require_docs_on_feature_change: true
  paths:
    - "docs/**"
    - "docs/adr/**"

supply_chain:
  require_signed_artifacts: true
  require_sbom: true
```

### 2.1 Top-Level `extends`
- `extends: org`
    - Use the **org baseline** as the starting point.
    - Repo only specifies overrides / additions.
- `extends: none`
    - Do not inherit from org baseline.
    - **Strongly discouraged**; only allowed with explicit governance approval.
    - CI prints a warning, but non-relaxable floors still apply (e.g., coverage
floors enforced by validators).

If `extends` is omitted → treated as `extends: org`.

---

## 3. Merge Semantics

Given:
- Base policy `B` (org-level `.github/policy.yml`)
- Repo policy `R` (`policy.yml` in the repo)
- Effective policy `E` = merge(`B`, `R`)

The merge rules are:

### 3.1 Resolve Base
```text
if R.extends == "org" or unset:
    B = org policy
if R.extends == "none":
    B = {}  (with warning; only allowed by governance)
```

### 3.2 Deep Merge Rules

For each key:
- **Objects**
    - Recurse and merge keys.
- **Scalars (string/number/boolean)**
    - Repo `R` wins (overrides base value).
- **Arrays**
    - `E[field] = union(B[field], R[field])`E[field] = union(B[field], R[field])
    - Example: reviewer teams are merged, not replaced.
- `extends` key
    - Used only as a directive, **not** included in the final `E`.

---

## 4. Non-Relaxable Constraints

After computing `E`, we enforce constraints against the original org policy `B_org`:

1. **Mode**
```text
If B_org.mode == "enforce" and E.mode == "advisory" → illegal
```

You cannot relax from **enforce** → **advisory**.

2. **Coverage**
```text
E.tests.coverage_min >= B_org.tests.coverage_min
```

Example:
- Org baseline: 80
- Repo: 90 → ✅ OK (tightening)
- Repo: 60 → ❌ FAIL (illegal relaxation)

3. **Security thresholds**

Threshold strictness order:
```text
none (weakest) < no-critical < no-high (strongest)
```

Repo must be **equal or more strict**:
```text
If B_org.security.sca_threshold = "no-high"
   and E.security.sca_threshold = "no-critical"
   → ❌ FAIL (weaker)
```

4. **Supply Chain**
- If org baseline requires signed artifacts or SBOM:
```text
require_signed_artifacts: true  → cannot be overridden to false
require_sbom: true              → cannot be overridden to false
```

If any violations are found:
- The merge fails
- CI returns a non-zero exit code
- A clear error message is reported

---

## 5. CI Flow — `policy-override-check.yml`

The reusable workflow:
- Validates the repo policy against the canonical schema
- Merges base + repo policies
- Enforces non-relaxable constraints

Consumer usage:
```yaml
# .github/workflows/policy-override.yml (in repo)
name: Policy Override Validation

on:
  pull_request:
    paths:
      - "policy.yml"

jobs:
  policy-override:
    uses: BrikByte-Studios/.github/.github/workflows/policy-override-check.yml@main
    with:
      repo_policy_path: "policy.yml"
```

On every PR that touches `policy.yml`:
1. Schema validation runs (`policy-validate.js`)
2. Merge + constraint checks run (`policy-merge.js`)
3. CI blocks illegal overrides

---

## 6. Good Examples
### 6.1 Tightening Coverage

Org baseline:
```yaml
tests:
  coverage_min: 80
```

Repo override:
```yaml
extends: org
tests:
  coverage_min: 90
```
→ ✅ CI passes.

---

### 6.2 Adding Reviewer Teams

Org baseline:
```yaml
reviews:
  required_approvals: 2
  additional_reviewer_teams:
    - "platform-leads"
```

Repo override:
```yaml
extends: org
reviews:
  additional_reviewer_teams:
    - "payments-team"
```

Effective policy:
```yaml
reviews:
  required_approvals: 2
  additional_reviewer_teams:
    - "platform-leads"
    - "payments-team"
```
→ ✅ Array union via merge.

---

### 6.3 Moving From Advisory → Enforce Locally

Org baseline:
```yaml
mode: "advisory"
```

Repo override:
```yaml
extends: org
mode: "enforce"
```
→ ✅ Allowed. Repo chooses to enforce the policy strictly.

---

## 7. Anti-Patterns (❌ Don’t Do This)
### 7.1 Copy-Paste the Entire Org Policy

❌ Bad:
```yaml
# policy.yml
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
# ... etc ...
```

Why it’s bad:
- You lose the benefit of central org updates.
- Drift is likely.
- Harder to audit and reason about.

✅ Prefer:
```yaml
extends: org
tests:
  coverage_min: 90
```

---

### 7.2 Relaxing Security Thresholds

Org baseline:
```yaml
security:
  sca_threshold: "no-critical"
```

Repo override:
```yaml
extends: org
security:
  sca_threshold: "none"
```

→ ❌ CI FAIL:

`security.sca_threshold ("none") cannot be weaker than org baseline ("no-critical")`.

---

### 7.3 Disabling Supply Chain Controls

Org baseline:
```yaml
supply_chain:
  require_signed_artifacts: true
  require_sbom: true
```

Repo override:
```yaml
extends: org
supply_chain:
  require_signed_artifacts: false
  require_sbom: false
```

→ ❌ CI FAIL (non-relaxable controls).

---

## 8. extends: none (Advanced / Rare)

`extends: none` is allowed **only with governance approval**:
```yaml
extends: none
policy_version: "1.0.0"
mode: "advisory"
# full schema-compliant content here
```

Use cases:
- Experimental repos
- POCs that deliberately opt-out of org baseline

Even with `extends: none`:
- Schema validation still applies.
- Future non-relaxable floors (like coverage >= 50) may still be enforced by validators.

If you think you need `extends: none`, open a PR and tag **@BrikByte-Studios/platform-lead**.

---

## 9. Quick Onboarding Checklist

For a new repo:

1. Create policy.yml:
```yaml
extends: org
policy_version: "1.0.0"

tests:
  coverage_min: 90
```

2. Add workflow:
```yaml
# .github/workflows/policy-override.yml
name: Policy Override Validation
on:
  pull_request:
    paths:
      - "policy.yml"
jobs:
  policy-override:
    uses: BrikByte-Studios/.github/.github/workflows/policy-override-check.yml@main
    with:
      repo_policy_path: "policy.yml"
```

3. Open PR → verify that CI:
- Passes for valid overrides
- Fails if you try to weaken coverage/security

If unsure, ask in the governance channel or ping **@BrikByte-Studios/platform-leads**.


---

## 4) `examples/policy/repo-policy.yml`

An example override file to put under `examples/policy/repo-policy.yml` in the `.github` repo.

```yaml
# examples/policy/repo-policy.yml
#
# Example: Repo-level policy override for a critical service.
#
# Demonstrates:
#   - extends: org
#   - Tightening coverage
#   - Adding reviewer teams
#   - Keeping security & supply-chain at least as strict as baseline

extends: org
policy_version: "1.0.0"

# This repo is critical, so we enforce policy strictly.
mode: "enforce"

reviews:
  # Keep org baseline approvals
  required_approvals: 2
  # Add extra reviewer team(s) specific to this repo
  additional_reviewer_teams:
    - "platform-leads"
    - "payments-team"

tests:
  # Tighten coverage above org baseline (80 → 90)
  coverage_min: 90
  require_tests_green: true
  critical_paths_only: false

security:
  # Keep or tighten thresholds
  sast_threshold: "no-high"
  sca_threshold: "no-high"
  dast_threshold: "no-critical"

docs:
  require_docs_on_feature_change: true
  paths:
    - "docs/**"
    - "docs/adr/**"
    - "adr/**"

supply_chain:
  require_signed_artifacts: true
  require_sbom: true
```