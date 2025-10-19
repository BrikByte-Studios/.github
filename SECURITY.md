# Security Policy — BrikByte Studios (.github Standards Repo)

This repository hosts **org-wide reusable workflows, issue/PR templates, and policy files**. It is the canonical source for security tooling and guidance that other repos in the org inherit.

---

## 📣 Report a Vulnerability

**Do NOT open a public issue** for security vulnerabilities.

- **Primary contact (preferred):** security@brikbyte-studios.com  
- **Backup contact:** security-backup@brikbyte-studios.com  
- **Encrypted reports:** PGP fingerprint `ABCD 1234 EFGH 5678 IJKL 9012 MNOP 3456 QRST UVWX 7890`  
  - Public key: see `docs/pgp/SECURITY.asc` (or request via email)

When reporting, please include:

- Affected repo(s) and component(s)
- Impact & severity (what could an attacker do?)
- Version / commit SHA
- Step-by-step reproduction
- Proof-of-concept (PoC) or exploit details
- Suggested remediation (if known)
- Your contact + whether you want recognition in release notes

We will acknowledge your report within the defined SLA below.

---

## 🔒 Scope

**In scope**
- All repositories under the **BrikByte Studios** GitHub organization
- Any production or staging services operated by BrikByte (API, web, CI/CD endpoints)
- Build artifacts produced by our official pipelines (containers, CLIs)

**Out of scope**
- Personal forks and non-BrikByte mirrors
- Third-party services not operated by BrikByte
- Social-engineering, phishing, physical security
- DOS/volumetric attacks (contact us first for coordinated testing)

---

## ✅ Responsible Disclosure & Safe Harbor

We support **coordinated disclosure**:
1. Report privately → work with us on a fix → public disclosure after a patch is available.
2. We won’t pursue legal action for **good-faith** testing that:
   - Avoids privacy violations and data exfiltration
   - Does not degrade service for other users
   - Respects rate limits and *never* attempts persistent DOS

If in doubt, email us before testing.

---

## 🛠️ Our Security Tooling (Org Baseline)

This standards repo defines and maintains the following reusable workflows (consumed by product repos):

- **CodeQL**: `.github/workflows/reuse-security-codeql.yml`  
  Static analysis; results appear in each repo’s *Security → Code scanning*.
- **Supply Chain (SBOM + Scanner)**: `.github/workflows/reuse-security-supplychain.yml`  
  Generates SBOM (CycloneDX or SPDX) and scans deps (Trivy/Grype); SARIF uploaded.
- **Metadata Lint**: `.github/workflows/reuse-metadata-lint.yml`  
  Validates `LICENSE`, `README`, `.gitattributes` (LF), `.gitignore` allowlist, and runs a secret scan.
- **Container Build**: `.github/workflows/reuse-container.yml`  
  Buildx with registry login (GHCR by default), cache, optional multi-arch.
- **PR Quality**: `.github/workflows/reuse-pr-quality.yml`  
  Conventional-commit title lint and optional auto-labels.

> Maintainers: ensure canary repos call these reusables and mark key jobs as **required checks** in branch protection.

---

## 🔁 Vulnerability Intake & Triage Process

1. **Acknowledgement** (≤ **2 business days**)  
   We confirm receipt and provide a tracking ID.
2. **Triage** (≤ **5 business days**)  
   Reproduce, assign CVSS score, determine affected versions/repositories.
3. **Remediation**  
   - Create a **GitHub Security Advisory (GHSA)** in the affected repo(s)  
   - Patch on a private branch or security fork; run CodeQL + Supply-chain checks
   - Prepare backports for supported versions (see below)
4. **Release**  
   - Ship patched versions; publish GHSA with credits (if desired)
   - Provide mitigation guidance and upgrade paths
5. **Post-mortem** (internal)  
   - Record root cause; add tests/lints/Rules; update reusable workflows if needed

**Communication windows**  
- Critical (CVSS ≥ 9.0): public advisory within **72 hours** of confirmed triage, patch as soon as safely possible  
- High (7.0–8.9): advisory within **7 days**  
- Medium/Low (< 7.0): advisory within **14–30 days**

---

## 🧮 Severity (CVSS v3.1)

We use CVSS v3.1 to prioritize response. Initial vector may be refined after deeper analysis.

| Score | Rating   | Typical Actions                          |
|------:|----------|-------------------------------------------|
| 9.0–10.0 | Critical | Immediate fix, hotfix releases, GHSA |
| 7.0–8.9 | High     | Accelerated patch, GHSA                 |
| 4.0–6.9 | Medium   | Next release cycle                      |
| 0.1–3.9 | Low      | Scheduled; documentation/defense-in-depth |

---

## 📦 Supported Versions

We generally support the **latest minor** and the **previous minor** for OSS libraries, and the **last two stable releases** for services/CLIs. Security fixes may be backported at our discretion for severe issues.

---

## 🧰 Guidance for Maintainers (What to do when you see a report)

1. **Create a GH Security Advisory (GHSA)** in the affected repo → *Security → Advisories → New draft advisory*  
2. **Link the private discussion** with reporters (email/PGP) and add `@security` + repo owners.
3. **Patch safely** on a **private security branch** (or GHSA private fork).  
   - Run org reusables: CodeQL, Supply-chain, Metadata Lint.
   - Add/extend tests demonstrating the failure and its fix.
4. **Cut releases** with `reuse-release.yml` (tag+notes).  
5. **Publish the advisory** and coordinate disclosure timing.

---

## 🚫 Prohibited Testing

- No automated traffic that **impacts availability** (stress/DOS) without prior written consent  
- No access to non-public data, accounts, or systems  
- No social engineering or phishing of staff/users  
- No physical intrusion or hardware attacks

---

## 🤫 Secrets Hygiene

- Never commit secrets/tokens/keys. Use **Actions Encrypted Secrets** or **Environments** with reviewers.  
- Our metadata lint and secret scanning (gitleaks) run on PRs — treat failures as **blocking**.  
- Rotation: compromised or at-risk credentials must be rotated immediately; document in the repo runbook.

---

## 🧾 Third-Party & Licensing

- Keep `LICENSE` text unmodified except for the copyright line.  
- For proprietary components, track third-party notices in `LICENSE-THIRD-PARTY.notice` and reference it in `README.md`.  
- SBOM generation is required for release artifacts in services and libraries advertised for reuse.

---

## 📝 Recommended `security.txt`

We recommend hosting a `/.well-known/security.txt` on public web properties.

Example:

- Contact: mailto:security@brikbyte-studios.com
- Encryption: https://raw.githubusercontent.com/BrikByte-Studios/.github/main/docs/pgp/SECURITY.asc
- Acknowledgments: https://github.com/BrikByte-Studios/.github/blob/main/SECURITY.md#hall-of-fame
- Preferred-Languages: en
- Canonical: https://github.com/BrikByte-Studios/.github/blob/main/SECURITY.md
- Policy: https://github.com/BrikByte-Studios/.github/blob/main/SECURITY.md


---

## 🙌 Hall of Fame (Thanks!)

We credit researchers who help us keep users safe (opt-in).  
Please tell us how you’d like to be recognized in the advisory and release notes.

- *Your name here*

---

## 📚 References (Org)

- **Code of Conduct:** `CONTRIBUTING.md` (this repo)  
- **Security Advisories:** use GitHub Security Advisories (GHSA) per repo  
- **Reusable Workflows:** see `.github/workflows/` in this repo  
- **Docs Hub:** https://github.com/BrikByte-Studios/brikbyteos-docs

---

## ⏱️ SLAs (Summary)

- Acknowledge: **≤ 2 business days**  
- Triage: **≤ 5 business days**  
- Fix window: based on CVSS (see above)  
- Status updates: at least **weekly** for open critical/high reports

---

## 🧪 Report Template (copy/paste)
```text
Title: <short vulnerability description>
Product/Repo:
Version/SHA:
Severity (self-assessed CVSS v3.1):
Vector (if known):

Summary:
<what is affected / why it matters>

Steps to Reproduce:
1.
2.
3.

Impact:
<data exposure / RCE / privilege escalation / integrity / availability>

PoC / Exploit:
<attach or link privately>

Suggested Remediation:
<optional>

Reporter:
Name/Handle:
Contact (email/PGP):
Recognition preference:
```

---

_Last updated: 2025-10-19_