# BrikByte Studios — Security Policy & Responsible Disclosure

At **BrikByte Studios**, we take the security and privacy of our users very seriously.  
We are committed to identifying, fixing, and learning from security issues across all of our products and platforms.

If you believe you’ve found a security vulnerability in any BrikByte service, library, or infrastructure, **please report it to us privately and responsibly.**  
Do **not** open a public GitHub issue.

---

## 🔍 Scope

This security policy applies to:

- All repositories under the **`BrikByte-Studios`** GitHub organization  
- BrikByteOS and related platform tooling  
- BrikByte product codebases and infrastructure, including (non-exhaustive):
  - CargoPulse
  - TeleMedEase
  - StackCraft templates and tooling
  - Light & Salt and other BrikByte SaaS products

It **does not** apply to:

- Third-party services that BrikByte uses (cloud providers, payment gateways, etc.)  
- Personal projects owned by contributors outside the `BrikByte-Studios` org

If you are unsure whether something is in scope, you can still contact us and we’ll clarify.

---

## 🛡 How to Report a Vulnerability

If you have found a security issue, please use **one** of the following:

1. **GitHub Security Advisories (preferred)**  
   - Go to the repository where you found the issue  
   - Navigate to **Security → Report a vulnerability**  
   - This will open a private communication channel with the maintainers

2. **Email (alternative)**  
   - Email: **security@brikbyte.dev**  
   - Subject: `SECURITY: <short description>`  
   - Use this if a GitHub advisory is not available or if the issue spans multiple repositories

> ⛔ **Please do not** report security issues via:  
> public GitHub issues, pull requests, social media, or public chat.

---

## 📄 What to Include in Your Report

To help us triage and remediate the issue quickly, please include as much of the following as possible:

- **Description**: Clear explanation of the vulnerability  
- **Impact**: What could an attacker do? What data or systems are at risk?  
- **Components affected**:
  - Repository / service name
  - Version / commit hash if known
  - Environment (prod, staging, dev, local)
- **Steps to reproduce**:
  - A minimal, step-by-step guide, commands, or payloads
  - Example requests or scripts (without real secrets)
- **Proof of concept (PoC)**:
  - Only if safe to share; please **redact any real user data or credentials**
- **Your contact details**:
  - So we can reach you for clarifications and updates

If you are unsure how much to include, err on the side of more **technical detail** and **less sensitive data**.

---

## ⏱ Our Response Process

We aim to follow this process for valid reports:

1. **Acknowledgement**  
   - We will acknowledge receipt of your report **within 3 business days**, where possible.

2. **Initial Triage**  
   - Assess severity and scope  
   - Confirm whether it is in scope and reproducible  
   - Decide on immediate mitigations (if any)

3. **Remediation**  
   - Investigate root cause  
   - Develop and test a fix  
   - Prepare rollout plan for affected environments  
   - Coordinate with SRE/DevOps and product teams if customer-impacting

4. **Notification & Disclosure**  
   - When appropriate, we may:
     - Publish release notes mentioning a security fix  
     - Update documentation and changelogs  
     - In some cases, coordinate a responsible public disclosure schedule

5. **Post-Incident Review** (for higher-severity issues)  
   - Document what happened, why, and how we fixed it  
   - Improve our tests, monitoring, and security controls  
   - Potentially create/update ADRs and governance policies

### Severity Guidelines (Indicative Only)

- **Critical (P0)** — Remote code execution, auth bypass, large-scale data compromise  
- **High (P1)** — Privilege escalation, sensitive data access, major integrity issues  
- **Medium (P2)** — Limited data exposure, significant misconfigurations, CSRF/XSS with constraints  
- **Low (P3)** — Minor info leaks, best-practice deviations, low-impact issues

We may adjust severity during investigation.

---

## ✅ Safe Harbor

We appreciate good-faith security research and will not pursue legal action against researchers who:

- Adhere to this policy  
- Avoid impacting availability, integrity, or confidentiality of real users’ data  
- Do not exploit vulnerabilities beyond what is necessary to prove their existence  
- Do not attempt to access, modify, or delete data that does not belong to you  
- Give us a reasonable opportunity to remediate before any public disclosure

**Out of bounds** activities include (but are not limited to):

- Social engineering (phishing, vishing, etc.) of BrikByte staff or customers  
- Physical attacks on BrikByte offices, data centers, or staff  
- Denial of Service (DoS/DDoS) or stress-testing production systems without prior written approval  
- Use of automated scanning tools that may degrade service quality for other users

If you are unsure whether your planned testing is acceptable, please contact us first.

---

## 🔐 Handling Sensitive Data

When reporting vulnerabilities:

- **Do not** include real customer data, secrets, or credentials  
- Use **redacted** or synthetic examples whenever possible  
- If you accidentally obtain access to sensitive data:
  - Do not store, copy, or share it further  
  - Report this clearly in your submission  
  - Delete any local copies after your report is submitted

---

## 🧩 Third-Party Dependencies

BrikByte products and BrikByteOS rely on various open-source and third-party components.

If you find a vulnerability in a third-party dependency:

- First, check whether it’s already reported upstream  
- If it affects BrikByte products in a specific way (e.g., configuration, integration), please still report it to us so we can:
  - Apply mitigations
  - Patch or upgrade dependencies
  - Coordinate with upstream if needed

---

## 💬 Questions About This Policy

For general questions (not vulnerability reports), you can:

- Open a **discussion** in:  
  `https://github.com/BrikByte-Studios/brikbyteos/discussions`
- Or email: **maintainers@brikbyte.dev**

For **actual vulnerabilities**, please always use:

- **GitHub Security Advisory** for the relevant repo, or  
- **security@brikbyte.dev**

---

Thank you for helping keep **BrikByte Studios** and our users safe. 🙏
