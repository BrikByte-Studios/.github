# BrikByte Studios — Policy Versioning (`policy_version`)

This document defines the **semantic versioning rules**, **upgrade expectations**, and **governance workflow** for the `policy_version` field used in `.github/policy.yml` files across all BrikByte Studios repositories.

Policy versioning ensures that:

- Governance changes are **explicit**, **traceable**, and **auditable**
- Product teams can adopt policy updates **predictably**
- BrikByteOS Pipelines can evolve **safely** without breaking existing repos
- ComplianceOps can produce **point-in-time snapshots** of effective governance

---

# 1. What Is `policy_version`?

`policy_version` is a **semantic version (semver)** string inside every `policy.yml`.

Example:

```yaml
policy_version: "1.0.0"
```

It represents the version of the policy content, not the schema version, and communicates:

- What rules are active
- Whether the definitions are advisory or enforceable
- What expectations BrikByteOS Pipelines or CI gates should enforce

This is distinct from:

`version` → schema version (integer), owned exclusively by governance.

---

# 2. Semver Rules (X.Y.Z)

BrikByte follows strict semver rules for `policy_version`.

### 2.1 MAJOR (X) — Breaking Changes

A **MAJOR** bump indicates a breaking change in governance semantics.

Examples:

- Introducing **new required fields** in schema
- Increasing minimum coverage floor
- Tightening SAST/SCA/DAST requirements
- Changing workflow expectations
- Changing policy mode from advisory → enforce for the org baseline
- Removing previously valid options

**Impact:**  
All repos **must** voluntarily upgrade; governance will communicate deadlines.

Example:
```diff
-policy_version: "1.0.0"
+policy_version: "2.0.0"   # Breaking change introduced
```

---

### 2.2 MINOR (Y) — Backward-Compatible Additions

A **MINOR** bump means new, optional capabilities were added, while existing policies` remain valid.

Examples:

- Adding optional fields (e.g., `supply_chain.require_sbom`)
- Adding optional doc paths or reviewer team features
- Adding new, non-required thresholds
- Adding new lints that are warning-only in advisory mode
- Allowing stricter override capabilities

**Impact:**
Repos may adopt when ready; nothing breaks if they stay on their current version.

Example:
```diff
-policy_version: "1.0.0"
+policy_version: "1.1.0"
```

---

### 2.3 PATCH (Z) — Non-Breaking Bugfixes

**PATCH** bumps fix mistakes without changing rule semantics.

Examples:
- Correcting typos
- Fixing misaligned defaults
- Documentation clarifications
- Adjusting optional field names without affecting behavior
- Fixing a validator bug that incorrectly rejected valid policies

**Impact:**  
Repos can update immediately; no changes needed.

Example:
```diff
-policy_version: "1.1.0"
+policy_version: "1.1.1"
```

---
# 3. How Policy Changes Are Introduced

All changes to:
- `.github/policy.yml`
- `docs/policy/policy.schema.json`
- `scripts/policy/policy-validate.js`
- `.github/workflows/policy-lint.yml`

must follow the **GOV-POLICY review procedure**:

#### 3.1 Required reviewers:
- Platform Lead (governance)
- Security Lead (for security sections)
- Engineering Manager(s)
- Compliance (for supply-chain or audit-related changes)

#### 3.2 Change steps:
1. Open a PR in `.github` repo
2. Include **updated policy**, **validator** changes, **docs** updates, and **version bump**
3. State the semantic intent (MAJOR, MINOR, PATCH)
4. Provide impact analysis
5. Provide migration guidance (if needed)

---

# 4. How Product Repos Should Adopt Policy Versions

Product repos that maintain their own `.github/policy.yml` should:

#### 4.1 Choose when to adopt MINOR/PATCH updates

Recommended cadence:
- **At least once per quarter**
- Or whenever breaking changes are announced (`X.0.0`)

#### 4.2 How to upgrade
```bash
# View org baseline
curl -s https://raw.githubusercontent.com/BrikByte-Studios/.github/main/.github/policy.yml

# Update your repo
vim .github/policy.yml  # or your editor of choice
```

Run validation locally:
```bash
node scripts/policy/policy-validate.js \
  --schema docs/policy/policy.schema.json \
  --file .github/policy.yml
```

Fix any lint issues → create PR → CI enforces correctness.

---

# 5. Breaking Changes Policy (MAJOR)

Breaking governance changes must:

1. Be announced via:
    - ADR update
    - Slack governance channel
    - Release notes in this repo

2. Provide:
    - A migration guide
    - Examples of updated policy.yml
    - Explanation of impact to BrikByteOS Pipelines

3. Not be rolled out without:
    - Approval from governance
    - At least one sprint migration window
    - Updated CI and validator compatibility

Example breaking changes:
- Raising org-wide coverage floor from 50 → 70
- Forcing DAST threshold from “no-high” → “no-critical”
- Adding **required** supply-chain signing


---

# 6. Advisory vs Enforce Modes

The baseline policy uses:
```yaml
mode: "advisory"
```

Repos may switch to:
```yaml
mode: "enforce"
```

#### Meaning:
- **Advisory:**
    - CI surfaces policy violations but does not block merges.

- **Enforce:**
    - Violations block merges.
    - Enforcement rules depend on pipeline integration (PIPE-POLICY-015).

**Important:**  
Mode changes do not require a MAJOR bump unless behavior changes org-wide.

---

# 7. Relationship to Schema Version (`version`)

Policy schema has its **own version** stored in `policy.schema.json`:
```json
{ "version": 1 }
```

Key differences:

| Field	| Meaning |	Modified By |
| --- | --- | --- |
| `version` | Schema version | Governance only |
| `policy_version` | Policy content version (semver) | Governance + repos |


Schema version changes rarely occur and typically require:
- `policy_version` **MAJOR** bump
- Validator script updates
- Extensive communication

---

# 8. Determining the Correct Version Bump

Use this flow:

**Q1 — Did the change break existing policies?**  
**→ MAJOR bump**

**Q2 — Did the change add new optional capabilities?**  
**→ MINOR bump**

**Q3 — Did the change fix errors or documentation only?**  
**→ PATCH bump**

If unsure → default to **MINOR**.

---

# 9. Best Practices for Teams

- Stay within **one minor version** of the org baseline
- Always run local validation before PR
- Favor **stricter overrides**, not weaker
- Document rationale in your repo’s ADRs when overriding org defaults

---

# 10.  Example Version Change Logs
### 10.1 Example: Minor addition
```diff
1.0.0 → 1.1.0
- Added supply_chain.require_sbom
- Added optional doc paths
```

### 10.2 Example: Patch fix
```diff
1.1.0 → 1.1.1
- Corrected default sca_threshold in docs
- Fixed validator’s error message formatting
```

### 10.3 Example: Major change
```diff
1.1.1 → 2.0.0
- Increased global coverage floor from 50 → 70
- Added mandatory DAST validation
```

---

# 11. Audit Considerations

ComplianceOps uses:
- `policy_version`
- `.audit/` bundles
- CI evidence
- Policy-lint logs

to generate point-in-time attestation for:

- ISO 27001
- SOC2
- POPIA
- Customer contractual requirements

A stable versioning strategy enables reproducible compliance.

---

# 12. FAQ

### Q: Do product repos have to adopt every policy change?

A: **MINOR** and **PATCH** changes are optional; **MAJOR** changes will eventually be required.

### Q: Can repos diverge from org policy?

A: Yes, if stricter. No, if weaker than required safety floors.

### Q: Does switching to `mode: enforce` require a version bump?

A: Only within that repo; org-wide enforcement would require a coordinated bump.

---

If in doubt, start a PR and tag **@BrikByte-Studios/platform-lead** for review.