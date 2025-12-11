---
id: "ADR-0012"                # e.g. ADR-0003 (4-digit padded)
seq: 12                        # integer, matches filename prefix
title: "Implement Playwright Base E2E Workflow (PIPE-E2E-PLAYWRIGHT-BUILD-001)"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-11              # YYYY-MM-DD
review_after: 2026-01-31

authors:
  - "Thapelo Magqazana"

area:
  - "CI/CD • QA Automation • Governance • E2E Testing"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Implement Playwright Base E2E Workflow (PIPE-E2E-PLAYWRIGHT-BUILD-001)

## Status

- **Status:** Accepted
- **Date:** 2025-12-11
- **Review After:** 2026-01-31
- **Authors:** Thapelo Magqazana
- **Area:** CI/CD • QA Automation • Governance • E2E Testing
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS requires a **standardized, deterministic, and governance-ready** E2E testing capability across all service repositories.  

Previously:

- Teams built **ad-hoc E2E setups**, resulting in inconsistent quality.
- No unified **browser matrix**, **sharding**, **retry strategy**, or **test evidence export** existed.
- Governance requirements (audit trail, reproducibility, SLAs) were not met by local service pipelines.
- Some services lacked E2E coverage entirely or used outdated Selenium-based flows.
- CI environments had no **single entry point** for UI regression testing.

Additionally:

- BrikByteOS is moving toward **automated evidence generation** (`.audit/PIPE-E2E/...`) with all CI pipelines producing machine-readable output.
- The Platform & QA Automation teams need a universal workflow that product teams can simply “opt into”.
- Increasing UI complexity in multi-service flows necessitates a modern E2E engine.

Given these constraints, Playwright was selected as the E2E automation framework and requires a **reusable GitHub Actions workflow**, consistent configuration file, and structured evidence export pattern.

---

## 2. Decision

We standardize on:

### **✔ Playwright as the BrikByteOS E2E testing framework**
and  
### **✔ A reusable CI workflow (`e2e-playwright.yml`) residing in the BrikByte-Studios/.github repo**

This workflow provides:

- Chromium (mandatory), optional Firefox/WebKit matrix  
- Test sharding via `workers: "50%"`  
- Standardized retry + trace configuration  
- Strict evidence export into:

```text  
.audit/PIPE-E2E/<run-id>/
```

- Automatic server startup for local UI apps  
- Artifact upload with unique naming conventions  
- Integration with upstream policy gates  

This aligns with BrikByteOS principles:

- **Standardize → Automate → Observe → Enforce**
- Governance-ready CI pipelines  
- Single source of truth for quality gates  
- Repeatability and test determinism  
- Lower maintenance cost across all product teams  

---

## 3. Alternatives Considered

### 3.1 Option A — Cypress
**Pros:**  
- Widely adopted  
- Strong debugging tools  

**Cons:**  
- Slower execution  
- Limited multi-browser support  
- Licensing uncertainty for future enterprise versions  

**Why Rejected:**  
- Missing governance-friendly artifacts and multi-browser parity.  

---

### 3.2 Option B — Selenium + WebDriver
**Pros:**  
- Legacy compatibility  
- Multi-language support  

**Cons:**  
- Slow  
- Flaky  
- High maintenance  
- Not aligned with modern CI-first workflows  

**Why Rejected:**  
- Inefficient for our scaling requirements and governance model.  

---

### 3.3 Option C — Playwright per repository (no reusable workflow)
**Pros:**  
- Local autonomy  
- Teams customize as needed  

**Cons:**  
- Fragmentation  
- Hard to maintain  
- Governance failure risk  
- Higher cost over time  

**Why Rejected:**  
- Violates BrikByteOS principle of **pipeline standardization**.  

---

### 3.4 Option D — **Reusable Playwright Workflow (✔ Chosen)**
**Pros:**  
- Standardizes E2E across org  
- Governance-ready evidence export  
- Browser matrix out of the box  
- Cost-efficient maintenance  
- Enables policy enforcement & quality baselines  

**Cons / Trade-offs:**  
- Initial onboarding required  
- Requires Playwright literacy across teams  

**Why Accepted:**  
- Provides best trade-off between developer experience, performance, and governance compliance.  
- Enables consistent E2E behavior at scale.  

---

## 4. Consequences

### Positive
- Unified E2E testing approach across BrikByteOS  
- Strong governance alignment via `.audit` exports  
- Faster CI due to Playwright + sharding  
- Lower long-term maintenance cost  
- Predictable multi-browser coverage  

### Negative / Risks
- Developers need to learn Playwright  
- Legacy services may require refactoring  
- CI time can increase initially as baseline is established  

### Mitigations
- Training & internal workshops  
- Migration guides per service  
- Incremental rollout with opt-in phases  
- Baseline E2E templates included in example repo  

---

## 5. Implementation Notes

- `e2e-playwright.yml` lives in **BrikByte-Studios/.github** and is consumed via `workflow_call`.  
- Product repositories (e.g. brik-pipe-examples, Cargo Pulse, TeleMedEase) import the workflow via:

```yaml
uses: BrikByte-Studios/.github/.github/workflows/e2e-playwright.yml@main
```

- All Playwright runs export evidence to:
```arduino
.audit/PIPE-E2E/<run-id>/
```
- Evidence includes:
  - `metadata.json`
  - Playwright HTML report
  - Traces
  - Screenshots
  - Raw test-results

- Benchmark workflow measures sharding impact (≥30% reduction recommended baseline).
- Future extensions:
  - LCP/CLS performance audit
  - Cross-service E2E test bundles
  - Visual regression suite
  - AI-assisted test flakiness analysis

---

## 6. References
- Playwright Docs: https://playwright.dev
- BrikByteOS Pipeline Stand
- Evidence Bundle Format (.audit) Specification
- Internal design document: https://example.com/design-doc




