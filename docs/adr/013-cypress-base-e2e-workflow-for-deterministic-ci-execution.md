---
id: "ADR-0013"                # e.g. ADR-0003 (4-digit padded)
seq: 13                        # integer, matches filename prefix
title: "Cypress Base E2E Workflow for Deterministic CI Execution"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-12              # YYYY-MM-DD
review_after: 2026-01-31

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

# Cypress Base E2E Workflow for Deterministic CI Execution

## Status

- **Status:** Accepted
- **Date:** 2025-12-12
- **Review After:** 2026-01-31
- **Authors:** Thapelo Magqazana
- **Area:** CI/CD • QA Automation • E2E Testing
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS requires **repeatable, auditable, and deterministic end-to-end (E2E) testing** for UI services across demos, starter kits, and production-grade systems.

Historically, UI E2E testing in CI suffered from:
- **Non-deterministic environments**
  - Cypress versions drifting across machines
  - Browser inconsistencies
  - OS-level differences between developers and CI

- **Unreliable startup sequencing**
  - Cypress starting before the UI server is ready
  - Flaky failures due to race conditions

- **Inconsistent execution models**
  - Some teams running Cypress locally
  - Others relying on Cypress Cloud
  - Ad-hoc GitHub Actions per repository

- **Poor auditability**
  - Missing screenshots/videos
  - No standard artifact structure
  - Difficult to attach E2E evidence to compliance bundles

At the same time, BrikByteOS is explicitly designed to be:
- **Open-source first**
- **Offline-capable**
- **Governance-ready**
- **Reusable across many products**

This created a clear need to **standardize Cypress E2E execution** in a way that is:
- Deterministic
- Docker-native
- Reusable across repositories
- Compatible with both:
  - External environments (staging / preview URLs)
  - Docker-started UIs inside CI

---

## 2. Decision

We will **standardize Cypress E2E testing using a reusable, Docker-based GitHub Actions workflow**.

### Key aspects of the decision:
- Cypress **always runs inside the official `cypress/included` Docker image**
- UI services can be tested in **two supported modes**:
    1. **External target mode** (existing environment)
    2. **Docker-started mode** (build + run UI in CI)
- A **shared Docker network** is used when running UI + Cypress together
- **Explicit health checks** (`/health`) gate test execution
- **Screenshots and videos are always exported as CI artifacts**
- Cypress Cloud is **not used**
- Configuration is driven via:
  - `cypress.config.cjs`
  - Workflow inputs
  - Environment variables

This decision aligns with BrikByteOS principles of **standardization, automation, observability, and enforcement**.

---

## 3. Alternatives Considered

Below are the options evaluated.

At least **one rejected** and **one chosen** option are required.

---

### 3.1 Option A — Cypress Cloud (SaaS)
**Pros:**
- Minimal setup
- Built-in dashboards and reporting

**Cons:**
- External dependency
- Paid service
- Reduced control over execution environment
- Not suitable for air-gapped or offline CI
- Artifacts tied to vendor platform

**Why Rejected:**
- Conflicts with BrikByteOS offline-first and open-source philosophy
- Adds long-term vendor lock-in

---

### 3.2 Option B — Native GitHub Actions (non-Docker)
**Pros:**
- Simpler YAML
- Faster initial setup

**Cons:**
- Browser and OS drift
- Node/Cypress version inconsistencies
- Harder to reproduce failures locally
- Less deterministic over time

**Why Rejected:**
- Determinism and reproducibility are first-class requirements for BrikByteOS

---

### 3.3 Option C — Playwright-only E2E (No Cypress)
**Pros:**
- Strong Playwright ecosystem
- Already adopted elsewhere in BrikByteOS

**Cons:**
- Cypress remains widely used and requested
- Some teams prefer Cypress syntax and tooling
- Removes choice unnecessarily

**Why Rejected:**
- BrikByteOS supports both **Playwright and Cypress** with parity

---

### 3.4 **Option D — Docker-based Reusable Cypress Workflow (✔ Chosen)**
**Pros:**
- Fully deterministic execution
- Identical local and CI behavior
- No external SaaS dependency
- Strong governance and audit support
- Reusable across all UI services
- Works with Docker-started and external targets

**Cons / Trade-offs:**
- Slightly more complex workflow
- Requires Docker knowledge
- Slightly slower startup due to image pulls

**Why Accepted:**
- Best balance of determinism, governance, scalability, and developer experience
- Aligns directly with BrikByteOS platform strategy

---

## 4. Consequences

### Positive
- Standardized Cypress execution across all products
- Reduced flaky E2E failures
- Deterministic CI runs
- Clear artifact evidence for audits
- Easier onboarding for new projects
- Parity with Playwright E2E workflows

### Negative / Risks
- Initial migration effort for existing repos
- Learning curve for Docker networking
- Slight increase in CI runtime

### Mitigations
- Provide reference implementations (e.g. `node-ui-example`)
- Extensive inline documentation in workflows
- Reusable workflow hides most complexity from product teams

---

## 5. Implementation Notes
- Each UI service must provide:
  - `cypress.config.cjs`
  - `/health` endpoint (or equivalent)
  - Stable `data-testid` selectors
- Artifacts are exported to:
  - `tests/e2e/cypress/screenshots`
  - `tests/e2e/cypress/videos`
- Workflow is versioned and consumed via:
```yaml
uses: BrikByte-Studios/.github/.github/workflows/e2e-cypress.yml@main
```
- This ADR complements:
  - **ADR-0012 — Playwright Base E2E Workflow**

---

## 6. References

- Cypress Documentation: https://docs.cypress.io
- BrikByteOS Reusable Workflows
- ADR-0012 — Playwright Base E2E Workflow

