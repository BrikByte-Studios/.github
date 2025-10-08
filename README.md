## 🔀 Branch Protection Mode Switch Guide

This repository supports two operational modes for branch protection — optimized for **solo maintainers** or **team workflows**.  
The mode determines how strictly merges are gated and how automation enforces review and status-check policies.

---

### 🧩 Modes Overview

| Mode     | Description | Use Case |
|-----------|--------------|-----------|
| **STRICT** | Enforces reviews, required checks, and admin protection. | For team repos where multiple developers contribute via PRs. |
| **SOLO** | Eases restrictions, allowing direct pushes but keeps safe defaults. | For solo-maintainer repos or rapid iteration environments. |

---

### 🗂️ Policy Source

The policy configuration lives in:

.governance/policy.yml

Example:

```yaml
mode: solo
branches:
  - main
checks:
  strict:
    contexts: ["lint", "test", "codeql"]
  solo:
    contexts: ["test"]
teams:
  owners:
    governance: "@BrikByte-Studios/devops"
    security: "@BrikByte-Studios/security"
```

---

### ⚙️ Switching Modes
You can toggle between solo and strict using the GitHub CLI or the Actions tab.

**Option A — GitHub CLI**
```bash
# STRICT mode (team workflow)
gh workflow run branch-protection-toggle --ref main -f mode=strict

# SOLO mode (solo-maintainer workflow)
gh workflow run branch-protection-toggle --ref main -f mode=solo
```
Check the status:

```bash
gh run list --workflow=branch-protection-toggle.yml
gh run watch <run-id>
```
---

### Option B — GitHub UI
1. Go to **Actions** → **branch-protection-toggle**
2. Click **Run workflow**
3. Select **Branch**: main
4. Input **mode**: solo or strict
5. Click **Run workflow**

---

### ✅ After Running
- Branch-protection settings are automatically updated
- Evidence files are exported to:

```bash
.audit/YYYY-MM-DD/branch_protection_<branch>.json
```
- A PR is opened titled:
```bash
audit: branch protection export (<date>)
```

---

### 🧾 Verification
Check current protection via CLI:

```bash
gh api repos/${OWNER}/${REPO}/branches/main/protection | jq .
```
Expected results:
| Control     | STRICT | SOLO |
|-----------|--------------|-----------|
| Required PR reviews | On | Off |
| Code Owner review | On | Off |
| Required checks | lint, test, codeql | test |
| Enforce admins | On | Off |
| Signed commits | On | Off |
| Linear history | On | On |
| Force push | Off | Off |

---

### 🕵️ Compliance Check (Nightly)
The workflow `.github/workflows/compliance-branch-protection.yml` runs nightly to ensure live branch-protection matches `.governance/policy.yml`.
If drift is detected, the workflow fails to alert maintainers.

---

### 🧯 Troubleshooting
| Issue    | Cause | Fix |
|-----------|--------------|-----------|
| ❌ `403 Resource not accessible` | Token missing admin perms | Ensure `ADMIN_TOKEN` secret has `repo` + `admin:org` scope |
| ⚠️ `nothing to commit` in audit step | No new changes detected | Safe to ignore or re-run toggle after policy edit |
| ⛔ Push rejected in STRICT mode | Expected behavior | Use PRs with reviews |
| ✅ Direct push works in SOLO | Expected behavior | Safe for solo repos |
		
---

### 📘 Notes for Maintainers
- `.audit/` is gitignored; workflows auto-force add only new evidence.
- `.governance/policy.yml` is the single source of truth — edit and merge via PRs.
- Re-run toggle whenever you change policy or branch list.
- Ensure compliance job passes nightly to prevent drift.