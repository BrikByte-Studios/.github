---
id: "ADR-0015"                # e.g. ADR-0003 (4-digit padded)
seq: 15                        # integer, matches filename prefix
title: "Standardized E2E Screenshot, Video, and Trace Artifact Export Across Runners"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-13              # YYYY-MM-DD
review_after: 2026-03-31

authors:
  - "Thapelo Magqazana"

area:
  - "CI/CD • QA Automation • Audit & Governance"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Standardized E2E Screenshot, Video, and Trace Artifact Export Across Runners

## Status

- **Status:** Accepted
- **Date:** 2025-12-13
- **Review After:** 2026-03-31
- **Authors:** Thapelo Magqazana
- **Area:** CI/CD • QA Automation • Audit & Governance
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS supports multiple E2E test runners (Playwright, Cypress, Selenium) across heterogeneous product repositories.  
Prior to this decision, E2E artifacts were:

- Stored in runner-specific, non-deterministic directories
- Uploaded inconsistently or not at all
- Difficult to correlate to specific failures
- Non-audit-friendly (missing timestamps, browser context, or reproducibility)
- Frequently lost due to CI job failures or early exits

Concrete problems observed:

- **False-negative CI debugging** due to missing screenshots/videos
- **Inconsistent artifact paths**, causing `actions/upload-artifact` to warn or upload nothing
- **Runner-specific logic duplication** across workflows
- **Lack of governance evidence** for compliance, incident reviews, and RCA

This became critical as BrikByteOS pipelines moved toward:

- Audit-ready CI/CD
- Evidence-based QA enforcement
- Cross-repo pipeline reuse
- ISO-style traceability requirements

A single, deterministic, cross-runner artifact normalization strategy was required.


---

## 2. Decision

We will **standardize E2E artifact export across all supported runners** (Playwright, Cypress, Selenium) using a **single reusable exporter action** that normalizes artifacts into a deterministic `.audit` structure.

### Core decision points

- All E2E artifacts are exported via:
```text
BrikByte-Studios/.github/.github/actions/export-e2e-artifacts
```
- All artifacts are normalized into:
```text
.audit/YYYY-MM-DD/e2e/artifacts/
├─ screenshots/
├─ videos/
└─ traces/
```
- Artifact export behavior is driven by a **stable ENV contract**:
- `E2E_RUNNER`
- `E2E_BROWSER`
- `E2E_STATUS`
- `E2E_VIDEO`
- `E2E_TRACE`
- `E2E_ARTIFACTS_ALWAYS`

### Behavioral guarantees

- Screenshots are **always captured on failure**
- Videos and traces are **captured conditionally or always-on via flags**
- Exporter **never fails the job** if artifacts are missing
- Artifact naming is deterministic and reproducible
- No secrets or sensitive env values are logged or captured

This decision enforces a **single source of truth** for E2E evidence handling across BrikByteOS.

---

## 3. Alternatives Considered

### 3.1 Option A — Runner-Native Artifact Handling Only
**Pros:**
- Minimal initial effort
- Uses defaults provided by Playwright/Cypress/Selenium

**Cons:**
- Inconsistent paths
- No cross-runner standardization
- Poor auditability
- Difficult CI reuse

**Why Rejected:**
- Does not meet governance or audit requirements.

---

### 3.2 Option B — Per-Workflow Custom Artifact Logic
**Pros:**
- Flexible per-repo control
- Quick fixes possible

**Cons:**
- Code duplication
- Drift between repos
- High maintenance burden
- Error-prone

**Why Rejected:**
- Violates BrikByteOS platform standardization goals.

---

### 3.3 Option C — Third-Party Artifact Management Tool
**Pros:**
- Feature-rich
- External visualization

**Cons:**
- Vendor lock-in
- Cost
- Reduced transparency
- Limited control over data locality

**Why Rejected:**
- Conflicts with open-source-first and internal governance strategy.

---

### 3.4 **Option D — Unified Exporter Action + `.audit` Convention (✔ Chosen)**
**Pros:**
- Single normalization point
- Deterministic audit structure
- Cross-runner consistency
- CI-safe and non-fatal
- Strong governance alignment

**Cons / Trade-offs:**
- Initial refactor required
- Teams must align to ENV contract

**Why Accepted:**
- Best balance between developer experience, auditability, and long-term maintainability.
- Enables repeatable, inspectable E2E evidence across all BrikByteOS pipelines.


---

## 4. Consequences

### Positive
- Predictable artifact availability
- Faster root cause analysis
- Audit-ready CI/CD pipelines
- Reduced workflow complexity
- Easier onboarding for new repos

### Negative / Risks
- Migration effort for legacy workflows
- Short-term learning curve
- Potential missing artifacts if env contract is violated

### Mitigations
- Backward-compatible exporter defaults
- Clear documentation and examples
- Enforcement via pipeline templates
- Progressive rollout across repos 

---

## 5. Implementation Notes

- Exporter logic lives in:  
`.github/actions/export-e2e-artifacts/`

- Workflow responsibility:
- **Workflows do not manipulate artifacts**
- They only declare intent via inputs and env vars
- Upload responsibility:
- Always upload `.audit/**/e2e/artifacts/**`
- Never upload runner-native paths directly
- Artifact naming format:
```text
<browser><test-name><timestamp>.(png|mp4|zip)
```
- Guardrails:
- Max total size
- Max number of videos
- Silent no-op when nothing to export
---

## 6. References

- PIPE-E2E-ARTIFACTS-INTEG-004
- BrikByteOS CI/CD Governance Blueprints (D-007)
- GitHub Actions Reusable Workflow Standards

