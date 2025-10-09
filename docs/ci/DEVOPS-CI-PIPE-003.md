# DEVOPS-CI-PIPE-003 — Reusable Docker Build & Push with SBOM (CycloneDX) & Evidence

**Audience:** DevOps & Repo Maintainers  
**Owner:** DevOps Eng  
**Status:** Seed doc (production-ready pattern)  
**Last Updated:** YYYY-MM-DD

---

## 🎯 Goal

Provide a **reusable, org-hosted Docker workflow** that builds container images (multi-arch capable), **pushes to a registry**, generates an **SBOM (CycloneDX JSON)**, and captures **evidence** (digest, tags, platforms) for audit.  
Each product repo uses a **thin wrapper** to call the org workflow.

---

## ✅ Outcomes / Acceptance

- **Build → Push**: Image is built and (optionally) pushed; job outputs include an **image digest** (`…@sha256:…`).
- **Tags**: A **SHA tag** is present by default; **latest/semver** tags optional via metadata rules.
- **SBOM**: Artifact **`sbom/bom.json`** (CycloneDX) exists for pushed images.
- **Evidence**: **Step Summary** lists image, digest, tags, platforms and **`evidence/evidence.json`** is uploaded.
- **Metadata**: OCI labels include source repo, revision (SHA), and created timestamp.
- **Multi-arch**: If multiple platforms are requested, a **manifest list** is pushed successfully.
- **Performance**: Subsequent runs benefit from `buildx` **GHA cache**.

---

## 🧱 Architecture
```bash
BrikByte-Studios/.github (org governance repo)
└─ .github/workflows/reusable/docker-build-push.yml ← reusable workflow (tag: reusable-docker-build-push-v1)

Product repository (e.g., app-web)
└─ .github/workflows/docker.yml ← thin wrapper → uses @reusable-docker-build-push-v1
```

---

## 🔐 Prerequisites

- Default branch: `main`.
- Org allows **reusable workflows** from `BrikByte-Studios/.github` (same-org reuse if private).
- For **GHCR**: default **GITHUB_TOKEN** with `packages:write` is sufficient; set workflow permissions accordingly.  
- For **non-GHCR** registries: define repo/org secrets `REGISTRY_USERNAME` and `REGISTRY_PASSWORD`.

---

## ⚙️ Reusable Workflow (Org Repo)

**Path:** `BrikByte-Studios/.github/.github/workflows/reusable/docker-build-push.yml`  
**Tag:** `reusable-docker-build-push-v1`

**Inputs (workflow_call)**

| Input            | Type     | Default                      | Notes |
|------------------|----------|------------------------------|------|
| `image`          | string   | **required**                 | e.g., `ghcr.io/brikbyte/myapp` |
| `context`        | string   | `.`                          | Build context path |
| `dockerfile`     | string   | `Dockerfile`                 | Path relative to context |
| `platforms`      | string   | `linux/amd64`                | Comma-separated, e.g., `linux/amd64,linux/arm64` |
| `tags`           | string   | `type=sha,format=long`       | Rules for `docker/metadata-action@v5` |
| `build-args`     | string   | `""`                         | Multi-line `KEY=VAL` pairs |
| `secrets`        | string   | `""`                         | Multi-line `NAME=${{ secrets.X }}` |
| `push`           | boolean  | `true`                       | Set `false` for PRs/forks to avoid publishing |

**Secrets**

| Secret               | Required | Notes |
|----------------------|----------|------|
| `REGISTRY_USERNAME`  | no       | For non-GHCR registries |
| `REGISTRY_PASSWORD`  | no       | For non-GHCR registries |

**Key Features**

- **buildx** for multi-arch + **GHA cache** to speed rebuilds.
- **docker/metadata-action** for tags & labels.
- **anchore/sbom-action** for **CycloneDX** SBOM artifact (`bom.json`).
- Evidence: **`evidence/evidence.json`** + **Step Summary**.

> Tag **after** merging to provide a stable ref for consumers.

---

## 🪁 Consumer Wrapper (Per Repo)

**Path:** `.github/workflows/docker.yml`

```yaml
name: docker
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

permissions:
  contents: read
  packages: write

jobs:
  build-push:
    uses: BrikByte-Studios/.github/.github/workflows/reusable/docker-build-push.yml@reusable-docker-build-push-v1
    with:
      image: ghcr.io/brikbyte/myapp
      context: .
      dockerfile: Dockerfile
      platforms: linux/amd64,linux/arm64
      # Optional extra tags via metadata rules:
      # tags: |
      #   type=sha,format=long
      #   type=raw,value=latest,enable={{is_default_branch}}
      build-args: |
        COMMIT_SHA=${{ github.sha }}
      # Build on PRs but only push on non-PR events:
      push: ${{ github.event_name != 'pull_request' }}
```

**Non-GHCR usage:** Add `REGISTRY_USERNAME`/`REGISTRY_PASSWORD` secrets; the reusable workflow will log in using them.

---
## 🧪 Verification Plan
1. **Main push (push=true)**
     - Build & push completes; logs show `…@sha256:…` digest.
     - Registry lists the image with **SHA tag** (and any configured tags).
     - Artifact `sbom` contains `bom.json`.
     - Artifact `evidence/evidence.json` exists and includes image, digest, tags, platforms, SHA, ref, repo.

2. **PR event (push=false)**
    - Build runs (publishing skipped).
    - Evidence generation can still occur (digest not addressable remotely; SBOM step typically skipped).

3. **Multi-arch (if configured)**
    - `docker buildx imagetools inspect <image>@<digest>` shows a **manifest list** with requested platforms.

---
## 🔎 Evidence & SBOM
- **Step Summary:**
    - Image, digest, platforms, and the final set of tags (from metadata-action).

- **Artifacts:**
    - `sbom/bom.json` (CycloneDX)
    - `evidence/evidence.json` (structured JSON for audit pipelines)

Example `evidence.json` fields:

```json
{
  "image": "ghcr.io/brikbyte/myapp",
  "digest": "sha256:abc123...",
  "platforms": "linux/amd64,linux/arm64",
  "tags": ["ghcr.io/brikbyte/myapp:sha-aaaaaaaa", "ghcr.io/brikbyte/myapp:latest"],
  "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ref": "refs/heads/main",
  "repo": "BrikByte-Studios/app-web",
  "timestamp": "2025-10-09T00:00:00Z"
}
```
---
## 🧩 Common Patterns
- **Tag policy:** Keep **SHA** as canonical; allow `latest` only on protected branches; add **semver** on release tags.
- **Cache warmup:** First run is cold; subsequent runs leverage `cache-to: gha`.
- **PR safety:** Default `push: false` to avoid publishing from untrusted refs.
- **Private bases:** Use `secrets:` to pass auth tokens to pull private base images.

---

## 🧯 Troubleshooting
| Symptom               | Likely Cause | Fix |
|----------------------|----------|------|
| Unauthorized to GHCR | Missing `packages:write` or policy | Enable `packages: write` in workflow; org policy allows GHCR |
| No digest emitted | Build failed or `push: false` | Check build logs; enable push on trusted branches |
| SBOM missing | No pushed digest or step skipped | Generate only on non-PR pushes, or attach against local oci-layout (advanced) |
| Multi-arch not effective | Base image not multi-arch | Use multi-arch base; verify with `imagetools inspect` |
| Extra tags not present | `tags` input not configured | Provide additional `tags` rules via metadata-action syntax |

---

## 📚 Appendix
### A) Tag & Release (Org Workflow)
```bash
git switch -c feat/reusable-docker-build-push
git add .github/workflows/reusable/docker-build-push.yml
git commit -m "reusable: docker build+push with SBOM & evidence (DEVOPS-CI-PIPE-003)"
git tag -a reusable-docker-build-push-v1 -m "reusable docker build+push v1"
git push -u origin HEAD --tags
# gh release create reusable-docker-build-push-v1 --title "reusable docker build+push v1" --notes "buildx multi-arch; tags via metadata; CycloneDX SBOM; evidence.json"
```

### B) Consumer Quick Start
```bash
git switch -c feat/docker-build
mkdir -p .github/workflows
cat > .github/workflows/docker.yml <<'YAML'
name: docker
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions:
  contents: read
  packages: write
jobs:
  build-push:
    uses: BrikByte-Studios/.github/.github/workflows/reusable/docker-build-push.yml@reusable-docker-build-push-v1
    with:
      image: ghcr.io/brikbyte/myapp
      context: .
      dockerfile: Dockerfile
      platforms: linux/amd64,linux/arm64
      build-args: |
        COMMIT_SHA=${{ github.sha }}
      push: ${{ github.event_name != 'pull_request' }}
YAML
git add .github/workflows/docker.yml
git commit -m "ci: adopt reusable docker build+push + SBOM (DEVOPS-CI-PIPE-003)"
git push -u origin HEAD
gh pr create --title "ci: reusable docker build+push + SBOM" --body "Implements DEVOPS-CI-PIPE-003"
```