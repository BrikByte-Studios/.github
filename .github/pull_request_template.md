<!--
      BrikByte Studios — Pull Request Template
      Tip: keep sections brief but complete; collapse details when long.
-->

<h1 align="center">🚀 Pull Request • BrikByteOS</h1>

<p align="center">
  <sup>
    <b>PR Status:</b> Draft ▪️ Ready for Review ▪️ Ready to Merge
    &nbsp;•&nbsp;
    <b>Type:</b> feat ▪️ fix ▪️ refactor ▪️ perf ▪️ test ▪️ docs ▪️ build ▪️ ci ▪️ chore
  </sup>
</p>

---

## 🧭 Summary
> One–two lines: **what** changed and **why** (business/user impact).

- …

## 🔗 Linked Issues / Tickets
- Closes #…
- Relates #…
- Incident/PIR: …

---

## 🧩 What Changed
- [ ] Code
- [ ] Config / IaC
- [ ] CI/CD
- [ ] Documentation
- [ ] Tests
- [ ] Observability (dashboards/alerts)
- [ ] Security (policies/secrets)

<details>
<summary>Diff Highlights (optional)</summary>

- Key modules touched:
- Interfaces/contracts changed:
- Data model / migrations:
</details>

---

## ✅ Validation & Evidence
Check all that apply and attach proof (artifacts, screenshots, logs).

- [ ] **Unit tests** added/updated — pass locally & CI
- [ ] **UI (Playwright)** runs — attach run summary / screenshot
- [ ] **API (Karate)** suites green — attach report link
- [ ] **Perf (k6)** smoke/regression unchanged (p95 budget met)
- [ ] **Security**: CodeQL reviewed; secrets unchanged; SBOM generated (if build)
- [ ] **Manual QA** steps performed (below)

<details>
<summary>Manual QA Steps</summary>

1. …
2. …
3. …

**Expected:** …
</details>

---

## ⚙️ CI/CD Gates (must pass)
- [ ] `lint` ✅
- [ ] `test` ✅
- [ ] `codeql` ✅
- [ ] Branch protection satisfied (no force-push / signed commits)
- [ ] Code Owner approvals obtained (if applicable)

---

## 📸 Screenshots / GIF (optional)
> UI/visual changes

| Before | After |
|-------:|:-----|
| ![before](…) | ![after](…) |

---

## 🧱 Breaking Changes?
- [ ] No
- [ ] **Yes** — migration steps documented below

<details>
<summary>Migration / Rollback Plan</summary>

**Forward:** …

**Rollback:** …

**Data/Schema impacts:** …
</details>

---

## 🚀 Deployment Notes
- [ ] No special steps
- [ ] **Requires:** feature flag ▪️ config change ▪️ secret rotation ▪️ runbook update

<details>
<summary>Steps / Runbook Links</summary>

- Pre-deploy checks: …
- Deploy command/strategy: …
- Post-deploy smoke: …
- Rollback command: …
</details>

---

## 🔒 Security & Privacy
- [ ] Threat surface unchanged
- [ ] Handles secrets safely (no new plaintext)
- [ ] AuthZ/AuthN unaffected
- [ ] Data classification unchanged (no new PII)

Notes: …

---

## 📈 Performance & Budgets
- **API p95:** _target_ ≤ … ms | _measured_ … ms
- **LCP p95 (UI):** _target_ ≤ … ms | _measured_ … ms
- **Bundle Δ:** … kB (warn at +50 kB)

---

## 👀 Observability
- Dashboards updated/created: …
- Alerts/SLOs touched: …
- Log/trace fields added: …

---

## 🗂 Documentation
- [ ] README / ADRs updated
- [ ] API/contract docs updated
- [ ] Changelog entry added

---

## 🧪 Scope & Risk
**Size:** □ XS □ S □ M □ L □ XL  
**Risk:** □ Low □ Medium □ High  
**Fallback:** □ Not needed □ Feature flag □ Safe rollback path in place

> Reviewer focus areas: …

---

## 🧾 Release Notes (user-facing)
- …

---

### 📝 Reviewer Checklist (for maintainers)
- [ ] Clear title (Conventional Commit)
- [ ] Scope limited; no unrelated changes
- [ ] Tests meaningful and isolated
- [ ] Security/perf considerations addressed
- [ ] Docs & changelog updated
- [ ] Ready to merge ✅

---

<sup>
This repository is governed by org policies in <code>BrikByte-Studios/.github</code> (branch protection, CODEOWNERS, compliance).  
SPDX-License-Identifier: MIT
</sup>
