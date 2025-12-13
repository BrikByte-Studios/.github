---
id: "ADR-0014"                # e.g. ADR-0003 (4-digit padded)
seq: 14                        # integer, matches filename prefix
title: "Selenium Grid E2E Workflow for Cross-Browser Testing"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-13              # YYYY-MM-DD
review_after: 2026-06-30

authors:
  - "Thapelo Magqazana"

area:
  - "CI/CD • QA Automation • E2E Testing"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Selenium Grid E2E Workflow for Cross-Browser Testing

## Status

- **Status:** Accepted
- **Date:** 2025-12-13
- **Review After:** 2026-06-30
- **Authors:** Thapelo Magqazana
- **Area:** CI/CD • QA Automation • E2E Testing
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS Pipelines require **deterministic, auditable, cross-browser end-to-end (E2E) testing**
to validate UI behavior across multiple browser engines.

While modern E2E frameworks such as **Playwright** and **Cypress** provide fast, stable feedback
for pull-request gating, they do not fully replace Selenium in the following scenarios:

- True cross-browser parity (Chrome, Firefox, Edge)
- Enterprise customer expectations and audits
- Regression testing across browser engines
- Compatibility with legacy UI behaviors and WebDriver standards

However, Selenium Grid introduces **non-trivial CI challenges**:

- High resource consumption
- Slower startup times
- Increased flakiness when run on every PR
- Susceptibility to partial readiness (hub ready, nodes not yet registered)

Recent pipeline failures highlighted the need for:
- Explicit Grid readiness and node-registration checks
- Guaranteed teardown on all execution paths
- Clear separation between fast PR feedback and deep regression validation

This decision is required **now** to stabilize E2E execution while preserving enterprise-grade coverage.

---

## 2. Decision

We will implement a **containerized Selenium Grid 4 E2E workflow** with the following characteristics:

- Docker Compose–based Selenium Grid (Hub + browser nodes)
- Chrome and Firefox enabled by default
- Optional Edge support via Docker Compose profiles
- Centralized reusable GitHub Actions workflow
- Explicit Grid readiness and node-registration health checks
- Mandatory teardown using `docker compose down -v`
- Rich audit artifact capture (logs, grid status, node logs)

### Execution Strategy

- **Selenium Grid runs on:**
  - Nightly scheduled workflows
  - Manual workflow dispatch (debugging / pre-release)
- **PR gating remains with:**
  - Playwright
  - Cypress

This preserves fast developer feedback while retaining deep cross-browser regression confidence.

The decision aligns with BrikByteOS principles:
- *Standardize → Automate → Observe → Enforce*
- Audit-ready by default
- Separation of concerns between speed and coverage 

---

## 3. Alternatives Considered

Below are the options evaluated.

At least **one rejected** and **one chosen** option are required.

---

### 3.1 Option A — Selenium Grid on Every Pull Request
**Pros:**
- Immediate cross-browser feedback
- Maximum regression coverage

**Cons:**
- Slow PR feedback loops
- High CI cost
- Increased flakiness
- Reduced developer productivity

**Why Rejected:**
- Violates fast-feedback principle
- Unacceptable CI instability for PR workflows

---

### 3.2 Option B — Remove Selenium Entirely
**Pros:**
- Faster pipelines
- Lower maintenance overhead

**Cons:**
- Loss of true cross-browser coverage
- Reduced enterprise credibility
- Incomplete regression assurance

**Why Rejected:**
- Selenium remains necessary for enterprise-grade E2E assurance

---

### 3.3 Option C — Playwright Only (All Browsers)
**Pros:**
- Excellent developer experience
- Fast execution
- Stable CI behavior

**Cons:**
- Not a full WebDriver substitute
- Limited parity with Selenium-based customer expectations

**Why Rejected:**
- Insufficient for legacy and enterprise audit requirements

---

### 3.4 **Option D — Selenium Grid as Nightly / Scheduled Workflow (✔ Chosen)**
**Pros:**
- Strong governance alignment
- Preserves cross-browser confidence
- Reduces CI flakiness
- Cost-effective execution
- Clear separation of responsibilities

**Cons / Trade-offs:**
- Browser regressions detected nightly instead of immediately
- Requires monitoring discipline

**Why Accepted:**
- Best balance of stability, coverage, and developer experience
- Aligns with BrikByteOS pipeline maturity model
- Enables scalable future evolution (Helm / Kubernetes)

---

## 4. Consequences

### Positive
- Deterministic cross-browser E2E validation
- Reduced PR pipeline duration
- Improved CI reliability
- Audit-ready execution artifacts
- Clear operational boundaries between tools

### Negative / Risks
- Slower detection of browser-specific regressions
- Additional workflow complexity

### Mitigations
- Nightly failure alerts and dashboards
- Manual dispatch for urgent validation
- Progressive migration to scalable infrastructure

---

## 5. Implementation Notes

- Selenium Grid is provisioned via Docker Compose in CI
- Grid readiness is enforced using a dedicated health-check action
- Tests start only after required nodes are registered
- All workflows enforce teardown using `always()` semantics
- Job-level timeouts prevent hung browser sessions
- Logs and grid status snapshots are exported to `.audit/selenium-grid/`

**Future roadmap:**
- Helm-based Selenium Grid deployment
- Kubernetes cluster support for elastic scaling
- Parallel test sharding at Grid level
- Selective PR-gate reintroduction for critical paths

---

## 6. References

- Selenium Grid 4 Documentation  
- BrikByteOS Pipelines Architecture  
- PIPE-E2E-SELENIUM-INTEG-003  
- ADR-0011 — Integration Test Audit Export Strategy  

