---
id: "ADR-0001"                # e.g. ADR-0003 (4-digit padded)
seq: 1                        # integer, matches filename prefix
title: "Supported runtimes & toolchain policy for BrikByteOS Pipelines build automation (v1)"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-30              # YYYY-MM-DD
review_after: 2026-06-30

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "PIPE"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Supported runtimes & toolchain policy for BrikByteOS Pipelines build automation (v1)

## Status

- **Status:** Accepted
- **Date:** 2025-12-30
- **Review After:** 2026-06-30
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** PIPE
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS Pipelines v1 introduces **Build Automation** templates that must be consistent across repos and product lines. Currently, build workflows vary per repository, leading to:

- Divergent runtime versions (e.g., Node 18 vs 20; Python 3.10 vs 3.12)
- Toolchain inconsistency (npm vs pnpm; pip vs poetry; Maven vs Gradle) causing drift and support burden
- Unclear “supported” definitions, making governance checks and validation arbitrary
- Poor auditability: standards exist informally, not as an enforceable contract

To support PIPE-CORE-1.1 (Multi-language Build Templates), we need a single, authoritative definition of:

- Supported runtimes and versions (including defaults)
- Supported toolchains and defaults
- Support tiers and adoption priority for v1 rollout
- Deprecation and exception policy (how older/edge versions are handled)

Constraints:

- GitHub Actions is the primary CI runtime in v1
- The platform must be deterministic and “policy-as-code” friendly
- Validation must work offline (CLI) and in CI without network dependencies

---

## 2. Decision

We will standardize supported runtimes and toolchains for BrikByteOS Pipelines Build Automation v1 using a **single source-of-truth runtime matrix** and enforce it through CI validation and CLI validation.

### 2.1 Canonical Source of Truth

- The authoritative contract is defined in:
  - `docs/pipelines/runtime-matrix.yml`

This file defines, per stack:

- `supportedVersions.policy` (e.g., N/N-1, LTS-only)
- `supportedVersions.versions` (explicit allowlist)
- `defaultVersion`
- Toolchain allowlists and defaults
- Default build conventions (install/test/build commands)
- Deprecation rules and exception process
- Support tier: supported | experimental | planned
- Adoption priority: primary | secondary

### 2.2 Version Policy (LTS-first)

- **LTS-first** policy: prefer vendor LTS lines.
- **N/N-1** where feasible:
  - Support current stable/LTS and previous stable/LTS line.
- **LTS-only** for stacks where ecosystem churn is costly (initially .NET v1).

### 2.3 Support Tiers (Mitigation 1)

We adopt support tiers to avoid blocking adoption while still maintaining governance clarity:

- **supported**: first-class support in templates and validation
- **experimental**: allowed only with explicit traceability (issue/ADR reference)
- **planned**: not usable yet; listed for roadmap visibility

### 2.4 Minimal-first rollout (Mitigation 3)

To reduce v1 complexity while still defining the full surface area:

- **Primary** stacks for v1 adoption: Node, Python
- **Secondary** stacks for v1 adoption: Java, .NET, Go

All stacks are defined in v1, but the “golden path” focus is Node/Python first.

### 2.5 Controlled Overrides / Exceptions (Mitigation 2)

Per-repo overrides are permitted only through a controlled exception model:

- Exception rules must be:
  - time-bound (`expiresOn`)
  - approved (`approval.owner` + `approval.reference`)
- Exceptions are recorded in the runtime matrix structure and enforced by validators.

### 2.6 Enforcement and Safeguards

- CI will run:
  - JSON schema validation (AJV) for the matrix
  - Policy sanity checks (e.g., defaultVersion compatibility, N/N-1 requires 2 versions)
- CLI (`brik-pipe validate`) mirrors the same rules using a vendored copy of the matrix.

Rationale:

- A single canonical contract prevents drift.
- Explicit tiers and controlled exceptions prevent “snowflake” repo behavior.
- Validation enables fast failure with actionable error messages.

---

## 3. Alternatives Considered

### 3.1 Option A — Per-repo custom CI definitions
**Pros:**
- Maximum flexibility per team
- No platform coupling

**Cons:**
- High drift and maintenance burden
- Governance enforcement becomes inconsistent
- Onboarding remains slow

**Why Rejected:**
- Fails the “productized CI/CD” goal of BrikByteOS Pipelines.

---

### 3.2 Option B — Document-only standards (no enforcement)
**Pros:**
- Lowest engineering cost
- Easy to publish

**Cons:**
- No compliance guarantees
- Standards decay quickly
- Builds remain inconsistent

**Why Rejected:**
- Docs without enforcement do not reduce drift.

---

### 3.3 Option C — Single mega-template for all languages
**Pros:**
- One workflow to maintain
- Centralized behavior

**Cons:**
- Complex interface; poor DX
- Hard to reason about differences per stack
- Increased change risk

**Why Rejected:**
- Over-generalization harms adoption and maintainability.

---

### 3.4 **Option D — Runtime matrix + stack-specific templates + validators (✔ Chosen)**
**Pros:**
- Single source of truth for policy
- Enforceable contract (CI + CLI)
- Clear support tiers and controlled exceptions
- Enables consistent build templates and predictable onboarding
- Aligns with BrikByte principles: Git-native, audit-ready, deterministic

**Cons / Trade-offs:**
- Requires upkeep (quarterly review)
- Some legacy repos may need exceptions or upgrades
- Initial engineering investment to implement validators and vendoring

**Why Accepted (Chosen):**
- Best balance of governance, developer experience, auditability, and maintainability.
- Enables PIPE-CORE-1.1.2 templates and PIPE-CORE-1.1.4 config validation to be deterministic. 

**Cons / Trade-offs:**  
- Requires onboarding / process updates  

**Why Accepted:**  
- Best balance of governance alignment and developer experience.  
- Enables traceable, reviewable decision history.  

---

## 4. Consequences

### Positive
- Standardized builds across repos
- Fast onboarding using reusable workflows
- Deterministic validation with actionable errors
- Clear governance posture for audits and compliance artifacts

### Negative / Risks
- Version policy disputes (e.g., Java 17 vs 21 default)
- Adoption friction for older repos
- Requires ongoing maintenance cadence

### Mitigations
- Support tiers (supported/experimental/planned)
- N/N-1 policy with controlled exceptions
- Minimal-first rollout (primary vs secondary)
- Quarterly review schedule, with recorded disputes and nextReview dates

---

## 5. Implementation Notes

- Canonical file: `docs/pipelines/runtime-matrix.yml`
- Schema: `schemas/runtime-matrix.schema.json`
- Validator (CI): `scripts/validate-runtime-matrix.mjs`
- Vendoring:
  - `brik-pipe-actions` vendors the matrix into an internal path and validates `.brik/build.yml`
  - `brik-pipe-cli` ships a vendored matrix for offline `brik-pipe validate`

Future work:
- Add automated sync PRs to update vendored copies from the canonical repo.
- Add stricter enforcement in “production” governance packs (supported-only on main/release).

---

## 6. References

- docs/pipelines/runtime-matrix.yml
- PIPE-CORE-1.1.1
- PIPE-CORE-1.1.2
- PIPE-CORE-1.1.4

