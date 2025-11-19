# Security Governance Policy
### PIPE-GOV-7.3.3 — SAST / SCA Severity Thresholds

This document defines how **application security scanning** (SAST + SCA) is governed using **policy-as-code** and enforced through BrikByteOS pipelines.

Security must be **explicit, auditable, consistent, and Git-native**.  
This policy ensures that every repository enforces the **same minimum security posture**, with clear rules for exceptions (waivers) and deterministic evaluation in CI.

---

## 1. Security Severity Scale (Canonical)

All tools must be normalized to the same severity scale:
```scss
none < low < medium < high < critical
```
| Rank | Severity | Description |
| --- | --- | --- |
| 0 | none | No impact or informational |
| 1 | low | Minor security concern, low exploitability |
| 2 | medium | Realistic risk, may be exploitable |
| 3 | high | Serious vulnerability, high impact |
| 4 | critical | Immediate risk, often requires emergency action |

All SAST/SCA results are converted into these buckets before evaluation.

---

## 2. Policy Configuration (`.github/policy.yml`)

The security policy defines tools and maximum allowed severity.

### 2.1 Standard Example (Org Level)
```yaml
security:
  sast:
    tool: "codeql"
    max_severity: "medium"     # highest allowed severity

  sca:
    tool: "npm-audit"
    max_severity: "high"       # one level more lenient than SAST
```

Meaning:
- SAST: no **high** or **critical** findings allowed
- SCA: no **critical** allowed


### 2.2 Repository Override (Tightening Only)

Repos may tighten thresholds:
```yaml
extends: "org"

security:
  sast:
    max_severity: "low"    # stricter than org
```

### ❗ Forbidden Override (Relaxing)
```yaml
security:
  sast:
    max_severity: "critical"   # ❌ Not allowed — relaxes org baseline
```

This will fail during **policy merge** (PIPE-GOV-7.2).

---

## 3. SAST & SCA Reports: How They Are Gathered

`gather.mjs` extracts SAST and SCA outputs and normalizes them.

Examples:

### 3.1 CodeQL (SARIF)

Mapped to:
```json
"sast": {
  "tool": "codeql",
  "counts": {
    "none": 0,
    "low": 8,
    "medium": 2,
    "high": 1,
    "critical": 0
  },
  "report_path": "reports/codeql.sarif"
}
```

### 3.2 npm-audit
```json
"sca": {
  "tool": "npm-audit",
  "counts": {
    "none": 0,
    "low": 5,
    "medium": 3,
    "high": 0,
    "critical": 1
  },
  "report_path": "reports/npm-audit.json"
}
```
---

## 4. Pass/Fail Logic (Gate Enforcement)

The gate:
1. Converts severities to integers (`none=0 … critical=4`)
2. Calculates **highest severity present**
3. Compares against `max_severity` from the **effective policy**

**Example**  
`security.sast.max_severity = "medium"`

SAST results include:
```makefile
high: 1
```

→ Highest severity = **high** → rank = 3  
→ Allowed max = **medium** → rank = 2

➡️ **Gate fails** unless a valid waiver covers the finding.

---

## 5. Waiver Mechanism

Waivers exist because sometimes:
- A vendor patch is not yet available
- A compensating control exists
- Legacy code requires staged remediation

Waivers must be:
- **Explicit**
- **Time-bound**
- **Approved**
- **Scoped to the exact finding**
- **Tracked with evidence**

---
### 5.1 Example of a Valid Waiver
```yaml
waivers:
  - rule: "security.sca"
    scope: "CVE-2025-12345"
    reason: "Payment SDK vendor patch due next week"
    ttl: "2025-12-31"
    approver: "@security-lead"
    evidence: "https://internal/wiki/waivers/CVE-2025-12345"
```
---
### 5.2 What Happens in CI?

If the SCA scan finds:
```makefile
critical: 1
CVE-2025-12345
```

And waiver matches:

➡️ Result becomes:
```json
"result": "fail_waived"
```
**CI passes**, but evidence is stored in:
```bash
.audit/<date>/PIPE-GOV-7.3.3/decision.json
```
---

## 6. Examples: Good & Bad Patterns
### 6.1 GOOD: Tightening Thresholds
```yaml
security:
  sast:
    max_severity: "low"
```
**Why good:** Improves security posture.

---
### 6.2 BAD: Relaxing Thresholds
```yaml
security:
  sca:
    max_severity: "critical"  # ❌ Relaxing org baseline
```

❌ **Not allowed** — org baseline is non-relaxable.  
PIPE-GOV-7.2 will reject the merge.

---
### 6.3 GOOD: Targeted, Time-Bound Waiver
```yaml
waivers:
  - rule: "security.sast"
    scope: "js/sql-injection@v1"
    ttl: "2025-01-15"
    reason: "Refactor in progress"
    approver: "@platform-lead"
```

✔ Scope is specific  
✔ TTL present  
✔ Reason + approver + path to fix

---
### 6.4 BAD: Blanket Waiver (Anti-Pattern)
```yaml
waivers:
  - rule: "security.sca"
    scope: "*"           # ❌ Blanket waivers are prohibited
    ttl: "2099-12-31"
    approver: "@someone"
```

❌ No repository may waive all vulnerabilities  
❌ No unlimited TTL  
❌ Security governance will block this  

---
### 6.5 BAD: Waiver With No TTL
```yaml
ttl: null      # ❌ Not allowed
```

All waivers **must** have expiry.

---

### 6.6 BAD: Waiver Without Approver
```yaml
waivers:
  - rule: "security.sast"
    scope: "CVE-2025-1111"
    reason: "Fix later"
    ttl: "2025-05-01"
    # missing approver ❌
```

❌ Fails schema validation.

---
### 6.7 BAD: Hiding Vulnerabilities by Not Checking in Reports

Not allowed.

The gate **requires**:
```bash
reports/codeql.sarif
reports/npm-audit.json
```

If missing → **Gate fails immediately**.

---

## 7. Anti-Patterns & Pitfalls (Must Avoid)
### 🚫 1. Relaxing severity thresholds
Security posture must never degrade.  
Only tightening is allowed.

### 🚫 2. Blanket waivers (`scope: "*"`)
Destroys auditability & security. Prohibited.

### 🚫 3. Waivers without TTL
Violates governance. All waivers must expire.

### 🚫 4. Waivers without explicit approvers
No self-approved waivers. Must be a security authority.

### 🚫 5. Waiving all critical vulnerabilities
Waivers are for **exception cases**, not systematic avoidance of remediation.

### 🚫 6. Using waivers to hide missing fixes
Waivers are not a substitute for remediation.

### 🚫 7. Not providing evidence links
Every waiver must link to compensating controls or rationale.

---
## 8. Decision JSON & Audit Artifacts

Gate produces:
```bash
.audit/<date>/PIPE-GOV-7.3.3/decision.json
```

Example:
```json
"security": {
  "sast": {
    "tool": "codeql",
    "max_severity": "medium",
    "highest_severity": "high",
    "result": "fail",
    "counts": { "none": 0, "low": 10, "medium": 2, "high": 1, "critical": 0 },
    "report_path": "reports/codeql.sarif"
  },
  "sca": {
    "tool": "npm-audit",
    "max_severity": "high",
    "highest_severity": "critical",
    "result": "fail_waived",
    "waivers_applied": ["CVE-2025-12345"],
    "report_path": "reports/npm-audit.json"
  }
}
```
---
## 9. References
- **ADR-0005** — SAST/SCA Severity Thresholds
- **ADR-0003** — Gate Architecture & Waiver System
- **PIPE-GOV-7.1** — Policy Schema
- **PIPE-GOV-7.2** — Non-Relaxable Overrides
- **PIPE-GOV-7.3.3** — Security Threshold Gate
- **CodeQL documentation**
- Semgrep rules & severity scale
- npm-audit, pip-audit, dependency-check guides

---
## 10. Summary

BrikByteOS security governance ensures:
- Consistent & enforceable security posture
- Explicit severity thresholds per repo
- Standardized report parsing
- Non-relaxable org baselines
- Tight, reviewable waivers
- Strong audit trail via `decision.json`

This allows BrikByte Studios to meet **enterprise-grade** compliance, reliability, and security expectations across all SaaS products.