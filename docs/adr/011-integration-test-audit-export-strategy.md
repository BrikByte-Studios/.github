---
id: "ADR-0011"                # e.g. ADR-0003 (4-digit padded)
seq: 11                        # integer, matches filename prefix
title: "Integration Test Audit Export Strategy"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-10              # YYYY-MM-DD
review_after: 2026-01-31

authors:
  - "Thapelo Magqazana"

area:
  - "CI/CD • QA Automation • Governance"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Integration Test Audit Export Strategy

## Status

- **Status:** Accepted
- **Date:** 2025-12-10
- **Review After:** 2026-01-31
- **Authors:** Thapelo Magqazana
- **Area:** CI/CD • QA Automation • Governance
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

As BrikByteOS transitions into a **governance-grade CI/CD platform**, integration testing now operates with:

- Real containers (app, DB, cache, mocks)
- Secrets and runtime environment injection
- Production-like data paths
- Health-gated startup orchestration

However, prior to this ADR:

- Integration test evidence was **ephemeral**
- Logs were lost after runner teardown
- JUnit results were inconsistently stored
- Failures could not be **forensically reconstructed**
- There was **no structured audit trail** aligned with:
  - SOC2
  - ISO 27001
  - Internal Governance Blueprints (D-007)

Additionally:

- GitHub Actions runners are short-lived
- Post-failure debugging relied on incomplete console logs
- Security requirements mandate **zero secret leakage in artifacts**

These constraints made it **impossible to guarantee auditability, traceability, and non-repudiation** of integration test executions.

This decision was required **now** because:

- PIPE-CORE-2.2 (Integration Test Stage) reached production maturity
- Secrets and fixtures are now live
- Root-cause automation depends on persistent evidence
- Governance reporting requires immutable CI artifacts

---

## 2. Decision

We will adopt a **standardized, mandatory integration test audit export mechanism** that:

- Always runs **regardless of test outcome**
- Exports a **timestamped .audit bundle at repo root**
- Sanitizes **all secrets and credentials**
- Persists:
  - Machine-readable results
  - Human-readable logs
  - Full execution metadata

### Core Mechanism

- Canonical exporter:
```text
.github/scripts/export-integration-audit.mjs
```

- Canonical storage format:
```text
.audit/YYYY-MM-DD/integration/
├─ junit.xml
├─ results.json
├─ logs/
│ ├─ app.log
│ ├─ db.log
│ ├─ cache.log
│ └─ tests.log
├─ coverage-summary.json (optional)
└─ metadata.json
```


- Export is executed with:
```bash
if: always()
```
- Output is uploaded as a **GitHub artifact**

### Rationale

This enables:

- Full CI forensic reconstruction
- Governance traceability for auditors
- Root-cause automation inputs
- Security incident investigation
- Historical trend analysis

This aligns with BrikByte’s principles of:

- **Observability-first design**
- **Policy-as-code governance**
- **Reproducible software delivery**

---

## 3. Alternatives Considered

### 3.1 Option A — Console Logs Only

**Pros:**
- Zero implementation cost
- Native GitHub UI support

**Cons:**
- Logs disappear after run
- No standardized structure
- Impossible to fully reconstruct failures
- No machine-readable artifacts

**Why Rejected:**
- Fails governance, audit, and forensics requirements.

---

### 3.2 Option B — Partial Artifact Uploads (JUnit Only)

**Pros:**
- Simple
- Provides pass/fail visibility

**Cons:**
- No container logs
- No DB or cache insight
- No runtime metadata
- No security guarantees

**Why Rejected:**
- Insufficient for root-cause analysis and compliance.

---

### 3.3 Option C — External Log Aggregation Only

**Pros:**
- Long-term storage
- Centralized dashboards

**Cons:**
- External dependency
- Cost overhead
- Not guaranteed per-repo traceability
- Risk of secret propagation

**Why Rejected:**
- Violates zero-trust CI design at early stage.

---

### 3.4 ✅ **Option D — Structured Local `.audit` Bundle + Artifact Upload (Chosen)**

**Pros:**
- Complete forensic trail
- Immutable per-run snapshot
- Secret sanitization guaranteed
- Works offline
- Zero vendor lock-in
- Enables AI-based root-cause analysis later

**Cons / Trade-offs:**
- Slight CI runtime overhead
- Requires developer onboarding
- Requires storage planning

**Why Accepted:**
- Best balance of:
- Governance enforceability
- Developer experience
- Security
- Automation readiness


---

## 4. Consequences

### ✅ Positive

- All integration runs become **auditable**
- Failures become **reproducible**
- Security incidents gain **traceable evidence**
- Root-cause AI agents gain **high-fidelity inputs**
- Governance reporting becomes **automated**

### ⚠️ Negative / Risks

- Increased CI artifact storage
- Slight runtime overhead
- Risk of misconfigured sanitization

### 🛡 Mitigations

- Artifact retention limits enforced
- Built-in secret sanitization:
- `INTEG_*`
- `JWT_*`
- `*_SECRET`
- `*_TOKEN`
- Final validation step before upload
- Progressive rollout per service

---

## 5. Implementation Notes

- Export is executed from **repo root** using:
```bash
node .github/scripts/export-integration-audit.mjs
```
- `.audit` directory is **always anchored at repo root**
- Export runs **after container teardown**
- All logs are captured using:
```nginx
docker logs
```
- Metadata includes:
  - Repo
  - Actor
  - Commit SHA
  - Branch
  - Run ID
  - Job
  - Workflow
  - Runtime
  - Service image
  - Start/end timestamps
  - Duration

- Ownership:
  - QA Automation Lead — correctness of test artifacts
  - DevOps Engineer — pipeline orchestration
  - Platform Lead — governance enforcement
---

## 6. References

- PIPE-INTEG-AUDIT-EXPORT-004 — Export Integration Test Evidence
- PIPE-CORE-2.2 — Integration Test Stage
- D-007 — Governance Blueprints
- brik-pipe-docs/security/integration-secrets.md

