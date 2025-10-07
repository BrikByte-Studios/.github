# BrikByte Studios — Security Policy

Thank you for helping keep BrikByte projects and users safe.

## 1) Reporting a Vulnerability

- **Email:** security@brikbyte.dev
- **PGP (optional):** See “PGP Key” below to encrypt your report.
- **Please include:** affected repo/name & version/commit, impact, PoC steps, logs/screenshots, and suggested fix if known.

**We do not accept reports via public issues/PRs**. Use the private channels above.

### Response SLAs
- **Acknowledgement:** within **2 business days**
- **Initial assessment:** within **5 business days**
- **Fix ETA (high severity):** target **≤ 30 days**
- **Coordinated disclosure:** we’ll agree a timeline with you (see §6)

---

## 2) Scope

- All repositories under **https://github.com/BrikByte-Studios**
- Infrastructure IaC, CI/CD workflows, templates, and starter kits included.
- **Out of scope:** third-party services outside our control, social engineering, physical attacks, DDoS/volumetric tests, spam/SEO reports, low-risk clickjacking on non-sensitive pages, use of leaked/compromised credentials.

---

## 3) Supported Versions

We prioritize security fixes for:
- The **default branch (`main`)** of each active repo
- The **latest stable release** (N-1) where applicable

Older, archived, or experimental branches may receive best-effort advice only.

---

## 4) Vulnerability Classes We Care About

- Authentication/authorization flaws (IDOR, privilege escalation)
- Injection (SQL/NoSQL/OS), RCE, SSRF, XXE, template injection
- Supply chain risks (dependency confusion, malicious packages)
- Data exposure (PII/secret leakage), cryptographic weaknesses
- CI/CD misconfig (secrets exfil, artifact poisoning)
- Container/cluster misconfig leading to tenant escape or code execution

---

## 5) Prohibited Testing

Please **do not**:
- Run **denial-of-service** or traffic floods
- Spam forms or production mailboxes
- Access, modify, or destroy data you don’t own
- Use **automated scanners** against production targets without written consent

If you need a safe target, ask us for a **test environment**.

---

## 6) Coordinated Disclosure & Safe Harbor

We practice **responsible, coordinated disclosure**:
- We will work with you on a **mutually agreed disclosure date** (typically 30–90 days).
- You may publicize details **after a fix/mitigation is available** or the agreed date passes.

**Safe Harbor:** If you make a good-faith effort to comply with this policy, we will not pursue legal action against you for applicable research activities.

---

## 7) How We Handle Reports (Process)

1. **Triage & reproduce**; assign a CVSS v3.1 severity (Critical/High/Med/Low).
2. **Mitigation plan** and patch development (may include dependency bumps, config hardening).
3. **Pre-disclosure** to affected stakeholders where necessary.
4. **Release fix** + **security advisory**; credit the reporter (opt-in).
5. **Post-fix hardening:** add tests, rules, or policy to prevent regression.

---

## 8) PGP Key

Fingerprint: 3A1B 2C3D 4E5F 6789 0ABC DEF1 2345 6789 0ABC DEF2
User ID: BrikByte Security security@brikbyte.dev
Public Key: https://security.brikbyte.dev/pgp.txt
Expires: 12 months from publication

(If the link is not yet available, email us to request the current key.)

---

## 9) Our Preventive Controls (at a glance)

- **Code Scanning:** GitHub CodeQL on all default branches
- **Dependency Scanning:** Dependabot & SBOM (Syft) on releases
- **Secrets:** `push-protection` and pre-commit hooks recommended
- **CI/CD:** required checks (lint/test/codeql), signed commits, protected branches
- **Containers:** reproducible builds, image provenance planned (cosign)
- **Infrastructure:** IaC validation (lint/policy), least-privileged tokens

---

## 10) Credits & Bounties

- We **credit** researchers in advisories upon request.
- We **do not currently operate** a paid bug bounty program.

---

## 11) Contact & Jurisdiction

- Primary: **security@brikbyte.dev**
- Backup: **security-incident@brikbyte.dev**
- Jurisdiction: South Africa (ZA). We aim to follow global best practices (FIRST, ISO/IEC 29147/30111).

---

## 📎Acceptance Criteria (for your WBS/Audit)

- `SECURITY.md` present at repo root and renders correctly in GitHub’s community profile.
- Contact email(s) valid; PGP key link present (or stub noted).
- SLAs and scope defined; safe-harbor language included.
- Preventive controls listed and aligned with org settings (CodeQL, Dependabot, branch protection).
- Evidence exported into `.audit/<date>/security_policy.json`.


**Proof commands**
```bash
# Community profile should show security policy present
gh api repos/BrikByte-Studios/.github/community/profile \
  > .audit/$day/community_profile.json

# Raw file capture (evidence)
gh api repos/BrikByte-Studios/.github/contents/SECURITY.md \
  > .audit/$day/security_policy.json
```

---
## 📝 Maintainer Notes

- Add a lightweight `/.well-known/security.txt` on your web domain when available; mirror contact details and PGP link.
- If you spin up a **public advisory**, use GitHub Security Advisories (GHSA) for CVE assignment when appropriate.
- Keep the **PGP key rotated yearly**; update fingerprint and link here and in `security.txt`.
- Tie this to your governance release (e.g., `governance-v1.0`) and reference in the release notes.