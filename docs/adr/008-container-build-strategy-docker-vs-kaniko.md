---
id: "ADR-0008"                # e.g. ADR-0003 (4-digit padded)
seq: 8                        # integer, matches filename prefix
title: "Container Build Strategy (Docker vs Kaniko)"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-26              # YYYY-MM-DD
review_after: 2026-06-01

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "containers"
  - "ci-cd"
  - "security"
  - "platform"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Container Build Strategy (Docker vs Kaniko)

## Status

- **Status:** Accepted
- **Date:** 2025-11-26
- **Review After:** 2026-06-01
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** containers, ci-cd, security, platform
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

## 1. Context

BrikByteOS is entering **production-grade delivery stage**, where containerization becomes foundational for:

- Local development workflows
- CI/CD pipelines
- Deployment orchestration
- Future multi-service platform workloads

Until now, container decisions were **ad-hoc and inconsistent**, leading to:

❗ Different teams building images differently  
❗ Docker-in-Docker failures on GitHub hosted runners  
❗ No guaranteed security standard for production builds  
❗ No mandated multi-stage / non-root runtime baseline  

To avoid fragmentation, we require **a single, documented and enforceable build approach**

---

## 2. Decision

> **CI MUST use Kaniko for container builds. Docker-in-Docker is prohibited on GitHub-hosted runners.**  
> **Developers SHOULD continue using Docker locally unless constrained.**

### The strategy:

| Environment | Tool | Reason |
|---|---|---|
| **Local Development** | Docker CLI (recommended) | Fast feedback, common tooling |
| **CI (GitHub-hosted)** | **Kaniko (mandatory)** | Daemonless, secure, predictable |
| **Self-hosted Runners** | Docker OR Kaniko (optional) | Choice allowed *only if Docker is isolated and rootless* |

### Security baselines (applies to all services)

☑ **Multi-stage builds required**  
☑ **Runtime images must run as non-root**  
☑ **Minimal distroless / alpine strongly preferred**  
☑ **Build context must not exceed service directory root**  

These rules will later be enforced via:

- CI policy gates
- Dockerfile linting
- Security scanners & SBOM requirements  

---

## 3. Alternatives Considered

### 3.1 Option A — Docker Everywhere  
**Pros:**  
- Familiar workflow  
- Good local DX  

**Cons:**  
- Docker-in-Docker unreliable in CI  
- Higher security attack surface  

**Why Rejected:**  
❌ CI runners cannot safely/consistently rely on Docker daemons.

---

### 3.2 Option B — BuildKit Only  
**Pros:**  
- Extremely fast + cache-aware  
- Next-gen container build engine  

**Cons:**  
- Higher setup complexity  
- Harder to standardize immediately  

**Why Rejected:**  
❌ Good future evolution, but too early as v1 standard.

---

### 3.3 Option C — Remote Cloud Builder (GCP/OCI/ECR Build Service)  
**Pros:**  
- Scalable + remote caching  
- Zero build weight on runners  

**Cons:**  
- Vendor lock-in  
- Additional auth + networking surface  

**Why Rejected:**  
❌ Future-friendly, but cost + onboarding overhead not justified for v1.

---

### 3.4 **Option D — Kaniko in CI + Docker for Local Dev (✔ Chosen)**  
**Pros:**  
- Daemonless (secure by design)  
- Works reliably on GitHub runner fleet  
- Multi-stage + non-root easy to enforce  

**Trade-offs:**  
- Developers maintain two tool contexts  
- Adoption curve for Kaniko scripts/pipelines  

**Why Accepted:**  
✔ Best balance between **security**, **reliability**, and **developer productivity**.  
✔ No Docker daemon dependency = predictable CI execution.

---

## 4. Consequences

### Positive  
- CI is daemon-free, stable, reproducible  
- Standardized image patterns across BrikByteOS  
- Aligns with platform hardening + future SBOM policies  

### Negative / Risks  
- Some teams will need onboarding for Kaniko  
- Build speed may be slower without caching initially  

### Mitigations  
- Provide reusable templates + Makefile wrappers  
- Introduce Kaniko caching in v2 (future ADR)  

---

## 5. Implementation Notes

| Deliverable | Repo |
|---|---|
| **container-build-strategy.md** | `brik-pipe-docs/containers/` |
| ADR-0008 (this file) | `brik-pipe-docs/docs/adr/` |
| Strategy reference link | `BrikByte-Studios/.github/README.md` |

### Follow-ups

1. Add **Kaniko reusable CI workflow template**  
2. Add **Dockerfile linter + non-root enforcement gate**  
3. Roll out strategy training session to BrikByteOS engineers  


---

## 6. References

- BrikByte Security Baseline (2025 roadmap)
- Pipeline Architecture EPIC: PIPE-CORE-1.2.1
- https://github.com/GoogleContainerTools/kaniko

