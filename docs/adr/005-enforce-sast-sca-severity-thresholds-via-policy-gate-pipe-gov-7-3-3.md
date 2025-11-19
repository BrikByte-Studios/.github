---
id: "ADR-0005"                # e.g. ADR-0003 (4-digit padded)
seq: 5                        # integer, matches filename prefix
title: "Enforce SAST/SCA severity thresholds via policy gate (PIPE-GOV-7.3.3)"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-19              # YYYY-MM-DD
review_after: 2026-05-17

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "PIPE"
  - "GOV"
  - "SEC"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Enforce SAST/SCA severity thresholds via policy gate (PIPE-GOV-7.3.3)

## Status

- **Status:** Proposed
- **Date:** 2025-11-19
- **Review After:** 2026-05-17
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** PIPE, GOV, SEC
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

Modern BrikByte products are required to maintain a consistently strong application security posture across all repositories, languages, and pipelines. While individual teams already run SAST (e.g., CodeQL, Semgrep) and SCA (e.g., npm-audit, pip-audit, dependency-check), these scans are currently:

- Configured per repo, with no central governance of thresholds.  
- Evaluated with ad-hoc pass/fail logic (or not enforced at all).  
- Lacking a standard, auditable record of why a pipeline passed or failed from a security perspective.  

This leads to several problems:

- **Inconsistent risk tolerance:** One repo may tolerate critical vulnerabilities, while another blocks on high severity, without an explicit, shared policy.  
- **Weak auditability:** It is hard to answer “What security thresholds were enforced for release X?” in a deterministic, Git-native way.  
- **Difficult waivers:** Exceptions (e.g., vendor patch not yet available) are handled informally, often in chats or emails, with no time-bound, reviewable record.  

Architecturally, BrikByte is standardizing on:

- **Policy-as-code** in `.github/policy.yml` (PIPE-GOV-7.1, 7.2).  
- **Central governance gates** that consume effective policy (org + repo) and emit a structured `decision.json` for each run (GOV-ADR-005 / ADR-0003).  

What changed:

- We now have a central policy schema, merge logic (`extends: org`), and basic gates (reviews, coverage) in place.  
- External compliance pressure (customers, auditors, and internal governance) requires that security thresholds be explicit, non-relaxable where mandated, and backed by machine-verifiable evidence.  

This ADR defines how SAST and SCA severity thresholds become **first-class, policy-driven gates** with standardized severity scales, non-relaxable org baselines, and explicit, time-bound waiver support.

---

## 2. Decision

We will:

1. **Codify SAST/SCA severity thresholds in policy**  
   - Extend `.github/policy.yml` and `policy.schema.json` with a `security` section that defines:  
     - `security.sast.tool` and `security.sast.max_severity`  
     - `security.sca.tool` and `security.sca.max_severity`  
   - Use a **single ordered severity scale**:
     - `none < low < medium < high < critical`  

2. **Normalize SAST/SCA outputs into common buckets**  
   - Update `scripts/policy/gather.mjs` to parse CodeQL/Semgrep (SAST) and npm-audit/pip-audit/dependency-check (SCA) outputs.  
   - Map tool-specific severities into the canonical scale and aggregate counts:  

     ```json
     "security": {
       "sast": {
         "tool": "codeql",
         "counts": { "none": 0, "low": 10, "medium": 3, "high": 1, "critical": 0 },
         "report_path": "path/to/codeql.sarif"
       },
       "sca": {
         "tool": "npm-audit",
         "counts": { "none": 0, "low": 2, "medium": 1, "high": 0, "critical": 1 },
         "report_path": "path/to/npm-audit.json"
       }
     }
     ```

3. **Implement policy-driven pass/fail logic in the gate**  
   - In `scripts/policy/eval.mjs`, convert severities to numeric ranks (e.g., `none=0, low=1, medium=2, high=3, critical=4`) and compute the **highest severity present** for SAST and SCA.  
   - Compare `highest_severity_rank` against `max_severity_rank` from the **effective policy** (org + repo merge).  
   - If any SAST/SCA finding exceeds `max_severity`, mark the gate as `fail` (subject to waiver rules).  

4. **Enforce non-relaxable org baselines via merge logic**  
   - Org policy provides a baseline `max_severity` for SAST and SCA.  
   - Repo-level overrides may only **tighten** thresholds (e.g., `high → medium`), never relax them (e.g., `high → critical` or `high → none`).  
   - This constraint is enforced in the policy-merge layer (PIPE-GOV-7.2); attempts to relax thresholds will **fail policy merge** with a clear error.  

5. **Introduce a time-bound waiver mechanism**  
   - Support waivers in policy (or a dedicated waiver config) with explicit fields:

     ```yaml
     waivers:
       - rule: "security.sca"
         scope: "CVE-2025-12345"
         reason: "Vendor patch not yet available; WAF rule in place"
         ttl: "2025-12-31"
         approver: "@security-lead"
         evidence: "https://internal/wiki/waivers/CVE-2025-12345"
     ```

   - Evaluation rules:
     - If a violation is present but **fully covered** by valid waivers (within TTL, scope matches, approver present), mark result as e.g. `"fail_waived"` but allow CI to pass.  
     - If any violating findings are **not covered** by waivers, mark result `"fail"` and block.  

6. **Record structured security evidence in `decision.json` and .audit bundles**  
   - Extend `decision.json` with a `security` section:

     ```json
     "security": {
       "sast": {
         "tool": "codeql",
         "max_severity": "medium",
         "highest_severity": "high",
         "counts": { "none": 0, "low": 10, "medium": 3, "high": 1, "critical": 0 },
         "result": "fail",
         "reason": "Found 1 high-severity issue above max_severity medium.",
         "report_path": "path/to/codeql.sarif"
       },
       "sca": {
         "tool": "npm-audit",
         "max_severity": "high",
         "highest_severity": "critical",
         "counts": { "none": 0, "low": 2, "medium": 1, "high": 0, "critical": 1 },
         "result": "fail_waived",
         "waivers_applied": [ { "scope": "CVE-2025-12345", "ttl": "2025-12-31" } ],
         "report_path": "path/to/npm-audit.json"
       }
     }
     ```

   - Persist this into `.audit/<date>/PIPE-GOV-7.3.3/decision.json` for audit trails and RTM linkage.  

Trade-offs:

- **Pros**
  - Strong, consistent governance across repos and languages.  
  - Clear audit trail for security posture per build.  
  - Time-bound, explicit waivers instead of informal exceptions.  

- **Cons**
  - Additional implementation and maintenance cost for parsers and mappings.  
  - Initial friction as teams adapt to standardized thresholds and waiver processes.  
  - Potential for pipeline friction if thresholds are set too aggressively too early.  

This decision aligns with BrikByte principles:

- **Git-native governance** (policy-as-code + decision-as-code).  
- **Deterministic, auditable gates** that can be reasoned about and replayed.  
- **Non-relaxable security baselines** with explicit, reviewable exceptions.

---

## 3. Alternatives Considered

Below are the options evaluated. At least one rejected and one chosen option are included.

### 3.1 Option A — Per-repo SAST/SCA configuration only (status quo)

**Pros:**  
- Simple for each team to configure independently.  
- No central tooling required.  
- Low up-front engineering investment.

**Cons:**  
- Inconsistent thresholds across repos; risk tolerance varies arbitrarily.  
- Hard to audit: no standardized decision artifact or central record.  
- Waivers are informal (tickets, chats) and often lack TTL or approver traceability.  
- Difficult to answer “Are we enforcing at least no-critical across all products?”

**Why Rejected:**  
- Fails governance and audit requirements.  
- Does not support organization-wide minimum standards or RTM mapping.  

---

### 3.2 Option B — Rely solely on GitHub code scanning / security center configuration

**Pros:**  
- Leverages vendor-managed UI and configuration.  
- Less custom code to maintain.  
- Some centralized reporting available via GitHub Enterprise security views.

**Cons:**  
- Configuration is UI-driven, not fully policy-as-code.  
- Limited ability to encode complex rules (e.g., waivers with TTL and evidence).  
- Hard to integrate consistently into existing policy gate and `decision.json` model.  
- Ties governance tightly to one vendor’s UI and abstractions.

**Why Rejected:**  
- Incompatible with BrikByte’s requirement for **Git-native, portable governance gates**.  
- Weak integration with existing policy and ADR-driven architecture decisions.  

---

### 3.3 Option C — Single global threshold without per-tool normalization

**Pros:**  
- Very simple: “no critical findings allowed anywhere.”  
- Minimal parsing logic; just check for a “critical” string in reports.  

**Cons:**  
- Tools report severities differently; lack of normalization leads to uneven enforcement.  
- No way to express more nuanced policies (e.g., “no high for SAST, but one high allowed for SCA with waiver”).  
- Does not scale to multi-language, multi-tool environments.

**Why Rejected:**  
- Too coarse for real-world use; either too lenient or too strict.  
- Does not support flexible yet governed security posture across diverse products.

---

### 3.4 **Option D — Policy-driven SAST/SCA thresholds with normalization and waivers (✔ Chosen)**

**Pros:**  
- Strong alignment with policy-as-code and governance strategy.  
- Normalized severity scale allows fair comparison across tools.  
- Non-relaxable org baselines protect minimum standards.  
- Explicit waiver model supports real-world constraints while remaining auditable.  
- Integrates seamlessly with existing gate architecture and `decision.json` evidence.

**Cons / Trade-offs:**  
- Requires implementation of parsers, severity mapping, and waiver handling.  
- Needs thoughtful rollout (advisory mode, progressive tightening).  
- Teams must learn how to configure SAST/SCA in policy and manage waivers.

**Why Accepted:**  
- Provides the best balance between **security posture**, **developer experience**, and **auditability**.  
- Extends the existing governance gate pattern (reviews, coverage) into security in a consistent way.  
- Enables traceable, reviewable security decisions per build and per release.

---

## 4. Consequences

### Positive

- **Standardized security thresholds** across all participating repos, reducing inconsistent risk tolerance.  
- **Improved auditability**: each run’s security decision is captured in `decision.json` and `.audit` bundles.  
- **Structured waivers** with TTL, approver, and evidence, replacing ad-hoc exceptions.  
- **Clear RTM hooks**: security requirements (REQ-SEC-*) can be mapped to tests, gates, and observed outcomes.  
- **Extensibility**: new tools or severity schemes can be integrated behind the same normalized interface.

### Negative / Risks

- **Initial friction:** pipelines may start failing where security findings were previously tolerated.  
- **Parser complexity:** mistakes in severity mapping could cause false passes or false failures.  
- **Waiver misuse:** overuse of waivers or missing TTL can degrade security over time if not governed well.  
- **Performance and rate limits:** large SAST/SCA reports may add processing time.

### Mitigations

- **Advisory rollout:** initially run the gate in warning mode (recording results but not failing CI), then gradually enforce.  
- **Robust test fixtures:** maintain sample SAST/SCA outputs and unit tests for mappings and pass/fail logic.  
- **Clear waiver policy:** document who can approve waivers, maximum TTL, and required compensating controls.  
- **Monitoring & review:** periodically review waivers and gate results as part of security governance.  

---

## 5. Implementation Notes

- **Schema & Policy**  
  - Extend `docs/policy/policy.schema.json` to include:
    - `security.sast.tool`, `security.sast.max_severity`  
    - `security.sca.tool`, `security.sca.max_severity`  
    - Severity enum: `"none" | "low" | "medium" | "high" | "critical"`.  
  - Add example `security` block to `.github/policy.yml` documenting recommended defaults.  

- **Gather Step (`scripts/policy/gather.mjs`)**  
  - Parse SAST reports (initially CodeQL SARIF, Semgrep JSON) and normalize severities.  
  - Parse SCA reports (npm-audit, pip-audit, dependency-check) similarly.  
  - Emit structured `security.sast` and `security.sca` objects with counts and `report_path`.  

- **Eval Step (`scripts/policy/eval.mjs`)**  
  - Implement a pure `evaluateSecurity()` function that:
    - Applies org + repo thresholds (non-relaxable).  
    - Computes highest severity and compares to `max_severity`.  
    - Resolves waivers (by `rule`, `scope`, `ttl`) and sets `result` to `"pass"`, `"fail"`, or `"fail_waived"`.  
    - Returns updated `decision` plus a `hasUnwaivedFailures` flag for the gate to act on.  

- **Decision & Audit**  
  - Extend `decision.json` schema and writer to include the `security` section.  
  - Ensure current gate workflow writes `.audit/<date>/PIPE-GOV-7.3.3/decision.json` with the full security decision.  

- **Documentation**  
  - Add `docs/policy/security.md` explaining:
    - Severity scale and mapping from tools.  
    - How to configure `max_severity` per tool.  
    - How non-relaxable baselines work with repo overrides.  
    - Waiver format, process, and governance expectations.  

---

## 6. References

- GOV-ADR-005 — ADR system & governance tooling  
- PIPE-GOV-7.1 — Central `.github/policy.yml` & schema  
- PIPE-GOV-7.2 — Repo-level policy overrides via `extends`  
- PIPE-GOV-7.3.1 — Branch-aware required reviewers  
- PIPE-GOV-7.3.2 — Minimum test coverage via policy gate  
- CodeQL, Semgrep, npm-audit, pip-audit, dependency-check official documentation  
- Internal security and compliance guidelines (BrikByte Studios)