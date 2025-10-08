# 🔒 Break-Glass Standard Operating Procedure (SOP)

**Purpose:**  
To safely and temporarily ease branch-protection rules during emergency situations while maintaining compliance, auditability, and segregation of duties (SoD).

---

## 🎯 Objectives
- Enable controlled “break-glass” overrides with **dual approval** from DevOps and Security.
- Enforce a **time-to-live (TTL)** so protections automatically revert to STRICT mode.
- Capture **evidence** (before/after JSON, metadata record) under `.audit/YYYY-MM-DD/`.
- Maintain full **traceability** and post-incident review capability (PIR).

---

## 🧭 Scope
This SOP applies to all **governance repositories** and **critical service branches** (`main`, `release/*`, `production`).

Break-glass may only be invoked under:
- Major incident (Sev1/Sev2) blocking CI/CD or production patching.
- Emergency compliance exceptions authorized by CTO or Security Lead.

---

## ⚙️ Technical Workflow

**Workflow:** `.github/workflows/break-glass.yml`

1. **Triggered manually** via  
   ```bash
   gh workflow run break-glass.yml --ref main \
     -f mode=solo \
     -f ttl_minutes=30 \
     -f reason="Sev2 API outage hotfix"
   ```
2. **Environment:** `break-glass`
    - Requires dual approval (DevOps + Security).
    - Enforces SoD: requestor cannot self-approve.

3. **TTL Enforcement:**
    - Max: 180 minutes.
    - Auto-restores STRICT via background job.

4. **Evidence Collection:**
    - `.audit/YYYY-MM-DD/pre_breakglass_main.json`
    - `.audit/YYYY-MM-DD/post_breakglass_main.json`
    - `.audit/YYYY-MM-DD/breakglass_record_<timestamp>.md`

5. **Compliance:**
    - Nightly drift job (`compliance-branch-protection.yml`) fails if SOLO persists beyond TTL.

--- 
## 🛡️ Control Objectives & Guardrails
| Control          | Description                        | Enforced By                                  |
|-----------------------------|--------------------------------------------|-----------------------------------------------------------|
| Dual Approval | Requires both DevOps & Security team review | Environment: break-glass |
| TTL Auto-Restore | STRICT re-applied ≤ 35 min after TTL expiry | Workflow job |
| Evidence Capture | JSON + record markdown committed | Workflow |
| SoD Enforcement | Requestor ≠ approver | Environment reviewers |
| Drift Detection | SOLO past TTL triggers nightly compliance failure | compliance job |
| Retention | Evidence kept ≥ 12 months | Repository policy |
		
---

## 🚨 Execution Flow
```text
1. Incident declared (Sev1/2)
2. DevOps initiates break-glass workflow
3. Security approves environment execution
4. Workflow applies SOLO policy via toggle
5. Hotfix / emergency change performed
6. TTL auto-restores STRICT
7. Evidence committed under .audit/
8. PIR completed within 24 hours
```
---
## 🧾 Post-Incident Review (PIR)

Use `/docs/governance/pir-template.md` after every break-glass event.

**Required sign-offs:**
- DevOps Lead
- Security Lead
- Compliance Officer

Attach:
- `.audit/DATE/` artifacts
- Incident ID or Jira ticket link

---

## 🧩 Roles & Responsibilities
| Role         | Responsibility                        |
|-----------------------------|--------------------------------------------|
| DevOps Engineer | Executes workflow; ensures TTL ≤ 180 min |
| Security Lead | Approves and verifies SoD adherence |
| Compliance | Validates evidence & archives audit artifacts |
| CTO / Eng Lead | Accountable for policy adherence |
| Product Owner | Informed of downtime or rollback impact |

---

## 🧰 Controls Mapping

| Framework         | Control Ref                         | Description                                  |
|-----------------------------|--------------------------------------------|-----------------------------------------------------------|
| ISO 27001 | A.12.1.2 | Change management |
| SOC 2 | CC6.6 | Emergency change control |
| POPIA | S19 | Data protection during incident handling |

---

## 🧭 Recovery & Rollback
- **Manual rollback:**
```bash
gh workflow run branch-protection-toggle.yml --ref main -f mode=strict
```
2. **Auto-restore:** TTL job re-applies STRICT automatically.
3. **If workflow fails:** re-run toggle manually; open PIR for RCA.

---

## 🧠 Notes for Maintainers

- Environment `break-glass` must remain protected (never deleted).
- Reviewers: `@BrikByte-Studios/devops` and `@BrikByte-Studios/security`.
- Evidence commits use `brikbyte-bot` identity.
- Update this SOP when control objectives, TTL policies, or reviewer teams change.

----
*Last reviewed: {{YYYY-MM-DD}}
Change owner: DevOps Lead
Version: 1.4 (DEVOPS-REP-GOV-004)*