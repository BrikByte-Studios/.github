# BrikByte Studios — Artifact Integrity Policy
### PIPE-GOV-7.3.5 — SBOM • Hashes • Signatures • Auditability

---

## 1. Purpose

This document defines the **artifact integrity requirements** for BrikByte Studios release pipelines.

These rules ensure that **production-bound artifacts** are:

- **Traceable**
- **Verifiable**
- **Tamper-evident**
- **SBOM-documented**
- **Signed by trusted identities**
- **Auditable for compliance, incident response, and supply-chain security**


Artifact integrity checks form part of the BrikByteOS **Governance Gate** and are enforced for:
- `release/*` branches
- Deployments where `target_env = prod`
- Any pipeline invoking ReleaseOps policies (PIPE-POLICY-015)

---

## 2. Policy Overview
```yaml
artifacts:
  require_sbom: true
  require_hashes: true
  require_signatures: true
  hash_algorithm: "sha256"
  sbom_format: "spdx-json"
  signature:
    tool: "cosign"
    verify_subject: "BrikByte-Studios"
```

These settings appear in:
- **Org-wide baseline:** `.github/policy.yml`
- **Per-repo overrides** (non-relaxable without justification)

---

## 3. Required Integrity Artifacts
### 3.1 SBOM (Software Bill of Materials)

- Required when `artifacts.require_sbom = true`
- Must follow the format:
  - `spdx-json` (current)
  - `cyclonedx-json` (future)

- Path convention:
  - `artifacts/sbom.spdx.json`    

- An SBOM must include:
  - Full dependency tree
  - Licenses
  - Package versions
  - Metadata about generator tool (Syft recommended)

---

### 3.2 Hash Manifest

Required when `artifacts.require_hashes = true`.

Expected file:
```bash
artifacts/manifest.json
```

Example format:
```json
{
  "artifacts/service-api-1.7.0.tgz": "beef1234abcd...",
  "artifacts/service-worker-1.7.0.tgz": "a1c2d3b4..."
}
```

Hash algorithm: **sha256**

---

### 3.3 Signatures

Required when `artifacts.require_signatures = true`.

Expected:
- Signatures produced using `cosign sign`
- Verified using:
  - `cosign verify --certificate-identity BrikByte-Studios …`


Gate checks:
- Signature exists
- Signature matches configured identity
- No expiration/invalid timestamp
- Verification output recorded to `.audit/.../decision.json`

---

## 4. Enforcement Rules

Artifact integrity checks are enforced **only for release pipelines**:
- Branch matches `release/*`
- OR environment sets `target_env=prod`
- OR ReleaseOps triggers the Release Governance Gate

If enforcement is active:

| Requirement |	Condition | Gate Behaviour |
| --- | --- | --- |
| SBOM missing | `require_sbom=true` | FAIL |
| Hash manifest missing or malformed | `require_hashes=true` | FAIL |
| Signature missing or invalid | `require_signatures=true` | FAIL |
| All present & valid | Any | PASS |


Audit logs contain:
```pgsql
decision.json.artifacts
```

including:
- `sbom_path`
- `hashes_manifest_path`
- `signature_verified`
- Failure reasons

---

## 5. Good Patterns vs. Anti-Patterns

### ✅ Good Patterns (Recommended)
#### 1. Generate SBOM as part of the build, not the release job
```sh
syft . -o json > artifacts/sbom.spdx.json
```

Reason: Eliminates drift between built artifact and scanned artifact.

---

#### 2. Create the hash manifest automatically
```sh
sha256sum artifacts/*.tgz > artifacts/manifest.json
```

✓ Consistent  
✓ Repeatable  
✓ Traceable

---

#### 3. Sign artifacts with a pipeline-scoped identity
```sh
cosign sign --key env://COSIGN_KEY artifacts/service-api.tgz
```

✓ Non-human keys  
✓ Rotatable  
✓ Easy to audit

---

#### 4. Verify signatures before evaluation

Produce verifier JSON:
```bash
artifacts/signature-results.json
```
so gather step can parse it.

---

#### 5. Keep all integrity files under the `artifacts/` folder
- SBOM
- Hashes
- Signatures
- Build metadata

→ Predictable paths = simpler governance rules.

---

#### 6. Fail fast on missing or malformed integrity metadata

The earlier the failure, the cheaper the fix.

---

### ❌ Anti-Patterns (Avoid)
#### 1. SBOM generated AFTER signing

Bad:
- You sign artifact A
- Then generate an SBOM for different contents
- Mismatch → invalid provenance

---

#### 2. Hash manifest created by hand

Bad:
```json
{
  "artifact.tgz": "just type something..."
}
```
→ Zero security value  
→ Causes undetected tampering

---

#### 3. Committing integrity artifacts into Git
- Hashes, SBOMs, and signatures **must be generated during CI**
- Never committed to repo

Reason: They represent build outputs, not source.

---

#### 4. Signing with developer laptops

Symptoms:
- Local cosign keys
- Human identities
- No revocation
- No audit trail

Fix: CI-managed signing identities only.

---

#### 5. Mixing SBOM formats inconsistently

Example: sometimes CycloneDX, sometimes SPDX.

→ Governance gate cannot parse reliably  
→ Makes audits harder

---

#### 6. Changing artifact names per build

Bad:
```bash
service-api-build123.tgz
```

Good:
```bash
service-api-1.7.0.tgz
```

Predictability enables downstream rules.

---

## 6. Example Release Pipeline (Good)
```yaml
steps:
  - name: Build
    run: make build

  - name: Generate SBOM
    run: syft . -o json > artifacts/sbom.spdx.json

  - name: Create Hash Manifest
    run: |
      echo "{" > artifacts/manifest.json
      for f in artifacts/*.tgz; do
        h=$(sha256sum "$f" | awk '{print $1}')
        echo "\"$f\": \"$h\"," >> artifacts/manifest.json
      done
      echo "}" >> artifacts/manifest.json

  - name: Sign Artifacts
    run: |
      for f in artifacts/*.tgz; do
        cosign sign --key env://COSIGN_KEY "$f"
      done

  - name: Verify Signatures
    run: |
      cosign verify artifacts/*.tgz \
        --certificate-identity "BrikByte-Studios" \
        > artifacts/signature-results.json
```

---

## 7. Example Release Pipeline (Anti-Pattern)
```yaml
steps:
  - name: Build
    run: make build

  - name: Sign Artifacts
    run: cosign sign ./dist/*.tgz   # WRONG: signing before producing SBOM

  - name: SBOM
    run: syft . > sbom.json         # WRONG PATH

  - name: Hash
    run: echo "{...}" > manifest.json  # WRONG: manual manifest

  - name: Verify
    run: echo "looks fine"           # WRONG: not verifying signatures
```

Reasons this pipeline will fail:
- Wrong SBOM path
- No hash manifest in expected format
- No JSON result from cosign verification
- Signing order incorrect
- Missing `artifacts/` conventions

---

## 8. Escalation, Waivers & Exceptions

Temporary exceptions must follow:
```yaml
waivers:
  - rule: "artifacts.integrity"
    scope: "sbom"
    reason: "Legacy build system not yet integrated"
    ttl: "2025-01-31"
    approver: "@security-lead"
    evidence: "https://internal/wiki/waiver123"
```

Waivers:
- Must have TTL
- Must be approved by Security Lead
- Will be marked as fail_waived in `decision.json`

---

## 9. Future Extensions
- Full re-hashing of artifacts
- Signature transparency logs
- Deep SPDX/CycloneDX validation
- SBOM diffing between releases
- org-wide SBOM registry
- SLSA provenance format support

---

## 10.  References

- **PIPE-GOV-7.3.5 — Artifact Integrity Checks**
- **PIPE-POLICY-015 — ReleaseOps Policy**
- Cosign Documentation
- SPDX Specification
- Syft (SBOM Generator)
- OWASP Software Supply Chain Cheat Sheet