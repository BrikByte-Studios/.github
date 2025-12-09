---
id: "ADR-0009"                # e.g. ADR-0003 (4-digit padded)
seq: 9                        # integer, matches filename prefix
title: "Standardized DB Fixtures and Service Mocks for Integration Tests"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-09              # YYYY-MM-DD
review_after: 2026-03-31

authors:
  - "Thapelo Magqazana"

area:
  - "integration-tests"
  - "ci-cd"
  - "brikpipe"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Standardized DB Fixtures and Service Mocks for Integration Tests

## Status

- **Status:** Proposed
- **Date:** 2025-12-09
- **Review After:** 2026-03-31
- **Authors:** Thapelo Magqazana
- **Area:** integration-tests, ci-cd, brikpipe
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikPipe runs containerized integration tests across multiple languages (Node, Python, Java, Go, .NET).  
Today:

- Each service seeds databases differently (SQL dumps, ad-hoc scripts, runtime inserts).
- External services are mocked inconsistently across languages.
- Schema drift between mocks and real providers goes undetected.
- CI failures are often non-deterministic due to:
  - partial DB state
  - inconsistent test ordering
  - missing baseline verification

This leads to:

- Flaky pipelines
- Low confidence in integration coverage
- High friction when debugging failures across teams

With the rollout of **PIPE-INTEG-FIXTURES-CONFIG-002**, BrikPipe now has a centralized mechanism for:

- Database fixture loading
- JSON-based seeding
- Service mock orchestration

A formal architectural decision is required to **standardize how fixtures and mocks are produced, validated, governed, and bypassed**.

---

## 2. Decision

We will adopt a **canonical, centralized fixture + mock architecture** for all BrikPipe integration tests with the following principles:

1. **Canonical Fixture Sets Only**
   - A small, versioned set of core fixtures per service.
   - Stored in:
     ```
     /tests/integration/fixtures/db
     ```

2. **Standardized Loader**
   - All fixture loading must go through:
     ```
     .github/scripts/db-load-fixtures.sh
     ```

3. **Mock Governance**
   - All service mocks must:
     - Be version-controlled
     - Be schema-validated against real providers (follow-up automation)
     - Live under:
       ```
       /tests/integration/mocks
       ```

4. **Optimized Loading Strategy**
   - Prefer:
     - `TRUNCATE + INSERT`
     - Batch inserts
     - Transactions where supported

5. **Post-Fixture Smoke Validation**
   - After every fixture load:
     - Verify baseline row counts
     - Verify presence of control records

6. **Contingency & Fail-Safe Controls**
   - Temporary bypass via:
     ```
     ENABLE_DB_FIXTURES=false
     ENABLE_SERVICE_MOCKS=false
     ```
   - Local dev fallback to:
     - In-memory stores
     - No-op mocks

This explicitly becomes **the only approved method** for BrikPipe integration data setup. 

---

## 3. Alternatives Considered



### 3.1 Option A — Fully Ad-Hoc Per-Test Data Setup

**Pros:**
- Maximum flexibility
- Developers control their own data

**Cons:**
- Flaky CI
- No baseline guarantees
- Massive duplication
- Hard to govern

**Why Rejected:**
- Directly conflicts with BrikPipe governance and repeatability goals.

---

### 3.2 Option B — One-Time DB Snapshot Per Repo

**Pros:**
- Faster test startup
- Simple to implement

**Cons:**
- Snapshot rot and schema drift
- Hard to update incrementally
- Poor multi-service reuse

**Why Rejected:**
- Unsafe long-term maintenance strategy.

---

### 3.3 Option C — Runtime Factory Data Generation

**Pros:**
- Highly flexible
- No static SQL required

**Cons:**
- Non-deterministic failures
- Data coupling to business logic
- Slower pipelines

**Why Rejected:**
- Violates determinism and auditability requirements.

---

### 3.4 ✅ Option D — **Canonical Fixtures + Governed Mocks (Chosen)**

**Pros:**
- Deterministic CI
- Cross-language alignment
- Auditable data
- Easy rollback + debugging
- Works with containers + local dev
- Enables governance + coverage enforcement

**Cons / Trade-offs:**
- Requires discipline
- Requires schema review process
- Limits per-test creativity

**Why Accepted:**
- Best balance of:
  - Governance
  - Reliability
  - Developer ergonomics
  - Long-term scalability

---

## 4. Consequences

### ✅ Positive

- Deterministic integration pipelines
- Easier debugging of failures
- Unified CI behavior across languages
- Strong governance & auditability
- Enables future automation:
  - schema validation
  - contract testing
  - AI-assisted test synthesis

### ⚠️ Negative / Risks

- Initial migration effort
- Teams must refactor existing tests
- Possible early CI instability

### 🛡 Mitigations

- Phased rollout per repo
- Temporary bypass flags
- Training + example repositories
- Dedicated fixture ownership

---

## 5. Implementation Notes

- Primary implementation tracked under:

#### PIPE-INTEG-FIXTURES-CONFIG-002

- Core scripts live in:

#### BrikByte-Studios/.github/.github/scripts

- Canonical fixture path:

#### /tests/integration/fixtures/db

- Canonical mock path:

#### /tests/integration/mocks


- Post-load smoke validation is **mandatory**.

- Follow-up ADRs will cover:
- Schema validation automation
- Contract testing enforcement
- Mock drift detection


---

## 6. References

- PIPE-INTEG-FIXTURES-CONFIG-002  
- BrikPipe Integration Test Runner  
- BrikByte Coverage Governance  

