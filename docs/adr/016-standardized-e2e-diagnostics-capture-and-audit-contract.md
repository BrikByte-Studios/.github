---
id: "ADR-0016"                # e.g. ADR-0003 (4-digit padded)
seq: 16                        # integer, matches filename prefix
title: "Standardized E2E Diagnostics Capture and Audit Contract"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-14              # YYYY-MM-DD
review_after: 2026-03-31

authors:
  - "Thapelo Magqazana"

area:
  - "CI/CD • QA Automation • Observability • Governance • AI Enablement"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Standardized E2E Diagnostics Capture and Audit Contract

## Status

- **Status:** Accepted
- **Date:** 2025-12-14
- **Review After:** 2026-03-31
- **Authors:** Thapelo Magqazana
- **Area:** CI/CD • QA Automation • Observability • Governance • AI Enablement
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

As BrikByteOS evolves into a **multi-repo, multi-runner software factory**, End-to-End (E2E) tests have become a **quality gate** rather than an optional signal.

Historically, E2E failures across Playwright, Cypress, and Selenium suffered from:

- Inconsistent or missing diagnostics (screenshots only, no context)
- Ad-hoc artifact naming and storage locations
- No stable contract for tooling or AI agents to consume
- High Mean Time To Resolution (MTTR) due to insufficient failure context
- Manual, error-prone debugging workflows

At the same time, BrikByteOS is introducing **AI-assisted QA agents** (e.g. *RootCauseExplainer*) that require **structured, deterministic inputs** to reliably analyze failures.

Key constraints and drivers:

- Multiple runners with **uneven diagnostic capabilities**
- Governance requirement for **audit-ready evidence**
- CI pipelines must remain **non-fatal on diagnostics capture**
- Downstream tooling must not break when a runner lacks a capability
- Diagnostics must be **portable, reviewable, and long-lived**

This decision is required **now** because:

- E2E is now enforced as a CI gate in foundation pipelines
- AI agents are being onboarded and require stable input schemas
- Without standardization, every repo reinvents diagnostics handling
- Observability gaps directly impact delivery velocity and trust

---

## 2. Decision

We will adopt a **standardized E2E diagnostics capture and audit contract** across all E2E runners (Playwright, Cypress, Selenium).

### Canonical Output Contract

On every E2E run (especially failures), diagnostics are normalized into:

```text
.audit/YYYY-MM-DD/e2e/diagnostics/
├─ console.json
├─ network.har
├─ trace.zip
├─ dom.html
└─ metadata.json
```
### Core Principles

- **Playwright is the gold standard**  
  Full-fidelity diagnostics (console, HAR, trace, DOM snapshot) are first-class.

- **Best-effort parity for Cypress and Selenium**  
  Where full parity is not technically feasible, partial diagnostics or placeholders are written.

- **Placeholders are intentional and valid**  
  Missing capabilities result in placeholder files, not missing files.

- **Never fail CI due to diagnostics capture**  
  Diagnostics capture is best-effort and non-fatal by design.

- **Stable filenames and structure**  
  Downstream tooling and AI agents rely on deterministic paths and filenames.

- **Audit-first design**  
  All diagnostics are written under `.audit/` and uploaded as CI artifacts.

### Rationale

This approach balances:

- Developer experience  
- Cross-runner reality  
- Governance requirements  
- AI enablement needs  

It ensures **observability without fragility**.

---

## 3. Alternatives Considered

### 3.1 Option A — Ad-hoc Diagnostics per Runner

**Pros:**
- Minimal upfront effort
- Native runner defaults

**Cons:**
- Inconsistent formats and locations
- No stable contract
- Impossible to automate AI analysis
- High MTTR

**Why Rejected:**
- Does not scale across repos or teams
- Fails governance and AI requirements

---

### 3.2 Option B — Playwright-Only Diagnostics Standard

**Pros:**
- Full-fidelity diagnostics
- Simple implementation

**Cons:**
- Excludes Cypress and Selenium users
- Forces premature runner migration

**Why Rejected:**
- BrikByteOS must support heterogeneous stacks

---

### 3.3 Option C — Fail CI if Any Diagnostic Is Missing

**Pros:**
- Strong enforcement
- Guarantees completeness

**Cons:**
- Brittle pipelines
- Breaks when runners lack capabilities
- Increases false negatives

**Why Rejected:**
- Violates resilience and developer trust principles

---

### 3.4 **Option D — Standardized Contract with Placeholders (✔ Chosen)**

**Pros:**
- Stable contract for all consumers
- Enables AI-assisted triage
- Runner-agnostic
- Audit-ready
- Non-fatal

**Cons / Trade-offs:**
- Placeholders may appear “incomplete”
- Requires education to avoid misinterpretation

**Why Accepted:**
- Best balance between governance, flexibility, and scale
- Explicitly encodes capability differences
- Unlocks AI agents without breaking pipelines

---

## 4. Consequences

### Positive

- Consistent diagnostics across all repos
- Reduced MTTR through richer failure context
- Strong audit and compliance posture
- Enables RootCauseExplainer and future AI agents
- Predictable tooling integration points

### Negative / Risks

- Increased artifact size (HAR + traces)
- Perceived confusion around placeholder files
- Additional implementation complexity

### Mitigations

- Capture heavy diagnostics only **on failure**
- Enforce size limits and future retention policies
- Document placeholder semantics clearly (this ADR)
- Metadata.json explicitly records what was captured vs simulated

---

## 5. Implementation Notes

- Diagnostics are normalized by:
  - `capture-e2e-diagnostics` GitHub Action
  - `capture-e2e-diagnostics.mjs` utility script

- Runner responsibilities:
  - **Playwright:** Produce real console/HAR/trace/DOM
  - **Cypress:** Best-effort console/DOM; partial network
  - **Selenium:** Console logs + DOM snapshot; no native HAR

- `metadata.json` is mandatory and always written.

- Placeholders are written when:
  - A runner lacks capability
  - A test crashes before capture
  - Diagnostics were not produced upstream

Ownership:
- QA Automation Lead (implementation)
- DevOps / Platform Lead (governance + CI wiring)

---

## 6. References

- PIPE-E2E-DIAGNOSTICS-INTEG-005  
- PIPE-E2E-ARTIFACTS-INTEG-004  
- BrikByteOS `.audit` governance conventions  
- RootCauseExplainer (D-005) input requirements

