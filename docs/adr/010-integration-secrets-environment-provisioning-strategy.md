---
id: "ADR-0010"                # e.g. ADR-0003 (4-digit padded)
seq: 10                        # integer, matches filename prefix
title: "Integration Secrets & Environment Provisioning Strategy"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-09              # YYYY-MM-DD
review_after: 2026-03-31

authors:
  - "Thapelo Magqazana"

area:
  - "security"
  - "ci-cd"
  - "integration-tests"
  - "brikpipe"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "code"
    label: "Integration Workflow"
    url: ".github/workflows/integration-test.yml"
  - type: "code"
    label: "Env Generator Script"
    url: ".github/scripts/env-generate-integration.sh"
---

# Integration Secrets & Environment Provisioning Strategy

## Status

- **Status:** Proposed
- **Date:** 2025-12-09
- **Review After:** 2026-03-31
- **Authors:** Thapelo Magqazana
- **Area:** security, ci-cd, integration-tests, brikpipe
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS is standardizing **containerized integration testing** across multiple languages and services. These tests require:

- Database credentials
- Auth secrets (JWT, API tokens)
- Mocked external service keys

### Problems Identified

- Secrets were:
  - Hardcoded in workflows
  - Stored in ungoverned `.env` files
  - Inconsistently named across services
- CI logs risked **accidental leakage**
- No standard enforcement mechanism existed

### Constraints

- CI must:
  - Never expose secrets in plaintext
  - Provide consistent naming across all services
  - Support local developer simulation without weakening security
- Forked PRs must not access secrets
- Governance must be auditable

This decision is needed **now** because:

- Containerized integration pipelines (PIPE-CORE-2.2) are going live
- External service mocks + DB fixtures require secrets
- Security posture must be enforced before scaling integration coverage

---

## 2. Decision

We will adopt a **GitHub Environments–based integration secrets strategy** using:

### ✅ GitHub Environment: `integration`
- All integration secrets will live **only** within this environment.

### ✅ Strict Naming Convention
All secrets must follow:
- #### INTEG_*

Examples:
- `INTEG_DB_USER`
- `INTEG_DB_PASS`
- `INTEG_DB_NAME`
- `INTEG_DB_HOST`
- `INTEG_DB_PORT`
- `JWT_SECRET_TEST`


### ✅ Secure Injection via Workflow

Secrets are injected only via:

`.github/workflows/integration-test.yml`

```yaml
environment: integration
env:
  DB_USER: ${{ secrets.INTEG_DB_USER }}
  DB_PASS: ${{ secrets.INTEG_DB_PASS }}
  JWT_SECRET: ${{ secrets.JWT_SECRET_TEST }}
```

### ✅ Runtime Env File Generation

Secrets are emitted into a runtime-only env file using:
```bash
.github/scripts/env-generate-integration.sh
```

This script:
- Reads required env vars
- Validates they are not empty
- Masks them using `::add-mask::`
- Writes `.env.integ.runtime`
- Fails fast if any required secret is missing

### ✅ Safe Developer Templates

Each example repo must include:
```bash
.env.integ.example
````

Containing **placeholders only**, e.g.:
```makefile
INTEG_DB_USER=
INTEG_DB_PASS=
INTEG_DB_NAME=app_test
INTEG_DB_HOST=localhost
INTEG_DB_PORT=5432
JWT_SECRET_TEST=
```

Local developer override:
```lua
.env.integ.local   (gitignored)
```

---

## 3. Alternatives Considered

### 3.1 Option A — Plain Repo Secrets
**Pros:**
- Easy to configure
- Fast setup

**Cons:**
- No environment isolation
- No approval gates
- Secrets exposed to all workflows

**Why Rejected:**
- Fails REQ-SEC-022 (environment isolation)

---
### 3.2 Option B — .env Files in Repo
**Pros:**
- Easy local usage
- Transparent debugging

**Cons:**
- High risk of accidental commit
- No masking guarantees
- No fork protection

**Why Rejected:**
- Violates REQ-SEC-021 (no secrets in Git)
- High breach probability

---

### 3.3 Option C — External Secret Manager (Vault, SSM)
**Pros:**
- Enterprise-grade
- Centralized rotation

**Cons:**
- Heavy operational overhead
- Slows down dev velocity
- Not required for current scale

**Why Rejected:**
- Premature complexity for BrikByteOS current maturity

---

### 3.4 ✅ Option D — GitHub Environments + Masked Injection (✔ Chosen)
**Pros:**
- Native GitHub support
- Automatic secret masking
- Fork PR isolation
- Environment-level access control
- Low operational friction

**Cons / Trade-offs**
- Secrets must be added to multiple repos initially
- Requires disciplined naming enforcement

**Why Accepted:**
- Best balance between:
  - Security
  - Developer Experience
  - Governance
  - Auditability  

---

## 4. Consequences

### ✅ Positive
- Secrets are never committed
- CI logs are automatically redacted
- Environment isolation is enforced
- Integration pipelines become security-auditable
- Supports future SOC2 / ISO27001 controls

### ⚠️ Negative / Risks
- Missing secrets cause pipeline failure
- Forked PRs cannot run full integration tests
- Manual secret management overhead

### 🛡 Mitigations
- Pre-flight validation in `env-generate-integration.sh`
- Clear failure messages on missing secrets
- `.env.integ.example` for developer clarity
- Local `.env.integ.local` allowed for dev-only runs

---

## 5. Implementation Notes

### Key Files
| File	| Purpose |
| --- | --- |
| `.github/workflows/integration-test.yml` |	Secure CI injection via `environment: integration` |
| `.github/scripts/env-generate-integration.sh` |	Runtime secret validation + masking |
| `.env.integ.example` |	Placeholder template for developers |
| `.gitignore` |	Blocks `.env.integ.local` |


### Enforcement Rules
- No `.env.integ` file is permitted in Git
- All missing secrets cause **hard CI failure**
- All secrets must be named with `INTEG_` prefix

---

## 6. References

- PIPE-INTEG-SECRETS-CONFIG-003
- PIPE-INTEG-CONTAINER-INIT-001
- REQ-SEC-021, REQ-SEC-022, REQ-SEC-023
- `.github/workflows/integration-test.yml`
- `.github/scripts/env-generate-integration.sh`

