# BrikByte Studios — Policy Gates (PIPE-GOV-8.x)
###  Unified Governance Engine for CI/CD, Releases, and Secure Software Supply Chain
---

## 1. Purpose

Policy Gates provide **deterministic, automated governance** across all BrikByte Studios products.
They ensure that every change—code, documentation, infrastructure, or artifacts—meets mandated standards before merging or releasing.

Policy Gates enforce rules from:

- `.github/policy.yml` (repo-level)
- **Org-level policy** (`org/policy.yml`)
- **Effective merged policy**
- **CI pipeline inputs**
- **Waivers** (time-bound, approved exceptions)

Everything is enforced via the **Gate Engine** (`scripts/policy/gate-engine.mjs`) and is fully **auditable** via `.audit/` bundles.

---

## 2. What the Gate Enforces

Policy Gates evaluate 6 governance dimensions:

| Domain | Example Rules |	Evidence Source |
| --- | --- | --- |
| Tests | `tests.green` | Unit/Integration Test reports |
| Coverage | `coverage.min` | Coverage summary JSON |
| Security | `security.sca`, `security.sast` | SCA/SAST scan outputs |
| ADR Governance | `adr.required_for_infra` | ADR index and PR metadata |
| Supply Chain Security | `supplychain.signed` | Sigstore / cosign evidence |
| Artifact Integrity | `integrity.sbom` | SBOM + integrity manifests |

The gate produces a **decision.json** with:
- Per-rule results
- Overall status (`passed`, `passed_with_warnings`, `failed`)
- Score (0–100)
- Waivers used
- Evidence/missing evidence
- Timestamp
- Policy version

Example (abbreviated):
```json
{
  "status": "passed_with_warnings",
  "score": 85,
  "rules": [
    {
      "id": "coverage.min",
      "result": "fail",
      "waived": true,
      "missing_evidence": false
    }
  ],
  "waivers_used": [...],
  "timestamp": "2025-11-20T20:02:00.000Z",
  "policy_version": "1.0.0"
}
```
---

## 3. Lifecycle
### 3.1 Source Inputs

1. **Effective Policy**  
   Produced by merging:
   - Org policy
   - Repo overrides (non-relaxable rules enforced)
2. **Aggregated Inputs** (`inputs.json`)  
   Generated in CI from:
   - Test result parsers
   - Coverage extractors
   - SAST/SCA scanners
   - ADR metadata extractor
   - SBOM/signature checks
3. **Waivers**  
   Structured, time-bound exceptions approved by governance leads.

---

## 4. Rule Evaluation Semantics
### 4.1 Rule Model

Each rule in `policy.rules` includes:
```yaml
rules:
  coverage.min:
    severity: block        # block | warn | info
    requires_evidence: true
    threshold: 80
```

### 4.2 Rule Result Types
- **pass**
- **warn**
- **fail**
- **fail (waived)** — fail but does not harm overall status
- **missing_evidence**

### 4.3 Waiver Semantics
A "fail" with an active waiver:
- stays `result = "fail"`
- but flagged `waived: true`
- ignored for overall status calculation
- contributes only a warning to final status

Example: `security.sca` critical issue waived →
result remains `"fail"` but overall status softens to `"passed_with_warnings"`.

---

## 5. Overall Status Logic
| Condition | Status |
| --- | --- |   
| Any unwaived block fail | `failed` |
| No block fails, but any warn/fail/waived-fail | `passed_with_warnings` |
| All pass | `passed` |


---

## 6. Score Calculation (0–100)

Heuristic:
- Start = **50**
- For each rule:
  - `block + pass` → +10
  - `block + fail` → −20
  - `warn + pass` → +5
  - `warn + fail` → 0
- Clamp: 0 ≤ score ≤ 100

Purpose:  
Provides a _governance health indicator_ for dashboards and long-term SLO tracking.

---

## 7. Evidence Requirements

Rules marked `requires_evidence: true` MUST provide supporting inputs.

### Examples:
### 7.1 Coverage
```json
{
  "coverage": {
    "line": 84.2,
    "report_url": ".../coverage"
  }
}
```

### 7.2 SBOM
```json
{
  "integrity": {
    "sbom_present": true,
    "sbom_url": "https://ci/.../sbom.json"
  }
}
```

Missing evidence → rule marked as:
```vbnet
result: "fail"
missing_evidence: true
```
---

## 8. Rule Evaluators (Implemented)
### 8.1 Tests
- Accepts: status="green" or failed=0
- Fails if:
    - tests missing but required
    - any failures

### 8.2 Coverage

Threshold check using `coverage.line`:
```arduino
line >= threshold ? pass : fail
```

### 8.3 Security

Supports `security.sca` and `security.sast`.

Policy examples:
```yaml
security.sca:
  max_level: no-critical
security.sast:
  max_level: no-high
```

Violations trigger `fail`.

### 8.4 ADR Governance

If policy requires ADR:
- ADR must be referenced (`ADR-000X`)
- Missing reference → fail
- Not required → pass

### 8.5 Supply Chain (Signatures)

Ensures artifacts are signed if required.

### 8.6 Integrity (SBOM)

Requires SBOM presence + integrity URLs.

---

## 9. Waivers
### 9.1 Shape
```json
{
  "rule": "security.sca",
  "scope": "temporary-relaxation",
  "reason": "Dependency migration in progress",
  "ttl": "2025-12-31",
  "approver": "@platform-lead",
  "evidence": "https://internal/wiki/waivers/123"
}
```

### 9.2 Rules
- Waivers expire via TTL
- Only governance leads may approve
- Multiple waivers may apply to the same rule
- All waivers are logged into `.audit/`

### 9.3 Effect
A waived failure:
- contributes warnings
- cannot block merges/releases

---

## 10. Directory Structure
```pgsql
docs/
  governance/
    policy-gates.md      <-- This file
scripts/
  policy/gate-engine.mjs
tests/
  policy-gate/
    gate-engine.unit.test.mjs
    gate-engine.integration.test.mjs
fixtures/
  policy-gate/
    policy.strict.json
    inputs.good.json
    inputs.bad-coverage.json
    inputs.bad-sca.json
    waivers.sca.json
```
---

## 11. CI Integration
### 11.1 Triggered on
- Pull requests → enforcement mode
- Release pipelines → hardened enforcement
- Nightly governance checks → advisory mode

## 11.2 Example
```csharp
npm run gate:int
node scripts/policy/gate-engine.mjs \
  --policy out/effective-policy.json \
  --inputs out/inputs.json \
  --waivers out/waivers.json \
  --out out/decision.json
```

### 11.3 CI must:

1. Generate **inputs.json**
2. Merge org+repo policies → **effective-policy.json**
3. Load **waivers.json**
4. Run **gate-engine.mjs**
5. Fail build if overall status == `failed`
6. Upload **.audit/** bundle as artifact

---

## 12.  Auditability

Every gate decision is appended into:
```pgsql
.audit/YYYY-MM-DD/PIPE-GOV-8.1/
  decision.json
  policy.json
  inputs.json
  waivers.json
  logs.txt
```

Meets requirements for:
- SOC2
- ISO 27001
- POPIA
- Internal governance compliance

---

## 13. Design Principles
- **Deterministic output** — same inputs always produce same decision
- **Explicit evidence** — no hidden heuristics
- **Fail loudly** — missing evidence is a failure
- **Waivers are transparent** — never silently accepted
- **Policy-as-code** — everything versioned
- **Auditable** — every decision leaves a trail
- **Extensible** — new rule types, new domains

---

## 14.  Future Extensions (v2)

- Machine-learning based governance scoring
- Policy visualization dashboards
- Branch-type adaptive policies
- AI-generated waiver recommendations
- SBOM diffing & dependency graph drift detection
- Infrastructure drift checks (Terraform plan scanning)

---

## 15. Human-Readable Governance Summary (PIPE-GOV-8.2)
### Unified, Reviewer-Friendly Output for PRs, CI, and Audits

The **Governance Summary** is the human-readable layer on top of `decision.json`.  
It transforms machine outputs into clear, concise, actionable reports for:
- Pull request reviewers
- Release managers
- Engineering and QA Leads
- Security and Governance auditors

It ensures that **every rule evaluation is understandable at a glance** and that required fixes are immediately visible.

---

### 15.1 Purpose

PIPE-GOV-8.2 solves the problem of **opaque governance outputs** by producing:
- A Markdown summary for pull requests
- A console summary for CI logs
- An optional HTML artifact for Governance Dashboards (v2)

This brings transparency and developer-friendliness to the policy gate.

Implemented in:
```pgsql
scripts/policy/summary.mjs
```
---

### 15.2 Inputs

The summary consumes:
| Input File | Description |
| --- | --- |
| `decision.json` | Output from `gate-engine.mjs` |
| `effective-policy.json` | Included for versioning & references |
| `inputs.json` | Used for link hydration (coverage/test URLs) |
| `waivers.json` | Used for waiver display block |


All information is enriched but not re-computed.
PIPE-GOV-8.2 is a renderer, not an evaluator.

---

### 15.3 Output Formats (8.2.1)
#### 15.3.1 Markdown (Primary)

Used for PR comments and CI summary:
- Table of rule results
- Overall governance status
- Recommended fixes
- Evidence links
- Waivers applied
- Missing evidence flag

#### 15.3.2 Console Mode

Printed automatically when run in terminal:
```arduino
npm run gate:summary
```

Color-coded using ANSI, for CI logs.

#### 15.3.3 HTML Report (optional)

Future extension for dashboards:
```pgsql
out/summary.html
```
---

### 15.4 Required Summary Structure (8.2.5)

Every summary MUST include the following sections:

#### 1. Header

Example:
```markdown
## Governance Summary (policy-gate)

**Overall Status:** ❌ Failed  
**Policy Version:** v1.0.0  
**Target Env:** prod • **Branch:** release/2025.10.15 • **Score:** 62/100
```

#### 2. Rule Results Table (8.2.2)

Columns:
```text
| Rule ID | Severity | Result | Waived | Details |
```
Rules marked `missing_evidence: true` MUST show a 🚫 or ⚠️ indicator.

#### 3. Recommended Fixes (8.2.3)

Auto-generated from rule remediation hints.

Examples:
- “Increase test coverage to ≥ 80%.”
- “Upgrade libX to 1.2.4 to remove CVE-2025-XXXX.”

If no fixes required:
```pgsql
No action required — all governance rules passed.
```

#### 4. Evidence & Links

Includes:
- Test reports
- Coverage URL
- SCA/SAST report
- SBOM
- ADR references
- Gate run URL

#### 5. Waivers Used (if present)

Includes:
- Waiver ID
- Approver
- TTL
- Rule affected

#### 6. Missing Evidence Block

Shown only when `missing_evidence.length > 0`.

Example:
```arduino
### Missing Evidence
- coverage.min → Coverage artifact missing (CI run 789)
```

---

#### 15.5 Summary Logic (8.2.2 & 8.2.3)
#### 15.5.1 Rule Display Logic

Each rule is rendered as:
```php-template
| <id> | <severity> | <emoji> Result | Waived? | <details> |
```

Emoji mapping:  
| Result | Emoji |
| --- | --- |
| pass | ✅ |
| warn | ⚠️ |
| fail | ❌ |
| missing_evidence | 🚫 |

#### 15.5.2 Recommended Fix Logic

Fixes are included when:
- rule has `remediation_hint`
- rule result is `fail` or `warn`
- OR rule result is `fail` but waived → still included as advisory

This ensures visibility even when waived.

---

### 15.6 PR Integration (8.2.4)

PIPE-GOV-8.2 integrates directly into PRs using:
```bash
.github/workflows/policy-gate.yml
```

PR workflow example:
```yaml
- name: Render governance summary
  if: always()
  run: node scripts/policy/summary.mjs \
       --decision out/decision.json \
       --out out/summary.md

- name: Post PR governance summary
  if: always() && github.event_name == 'pull_request'
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: node scripts/policy/comment.mjs out/summary.md
```

Produces a beautifully formatted PR comment:
- Overall score + status
- Rule table
- Evidence
- Fixes

---

### 15.7 Test Coverage (8.2.1–8.2.5)

PIPE-GOV-8.2 must include snapshot + assertion tests in:
```pgsql
tests/policy-gate/summary.test.mjs
tests/policy-gate/summary.fixtures.mjs
```

Tests include:  
| Test Case | Purpose |
| --- | --- |
| All-pass | Summary matches golden snapshot |
| Waived fail + fail | Summary includes fixes & waiver block |
| Missing evidence | Summary surfaces missing evidence section |
| Rule table structure | Columns are correct |
| Header metadata | Status, version, env, branch present |

---

### 15.8 `.audit/` Requirements

Every summary rendered MUST produce:
```pgsql
.audit/YYYY-MM-DD/PIPE-GOV-8.2/
  summary.md
  summary.json   (optional normalized form)
  context.json    (policy, inputs, waivers)
  log.txt
```

Summary files must be **immutable** once produced.

---

### 15.9 Developer Usability Goals

PIPE-GOV-8.2 prioritizes:
- **Clarity** → reviewers know exactly what failed
- **Actionability** → recommended fixes always shown
- **Consistency** → every repo sees the same format
- **Determinism** → snapshot tests ensure no drift
- **Audit readiness** → markdown is human, JSON is machine-friendly