# 🐳 BrikByteOS Docker Build Templates

This directory contains standardized **base Dockerfiles** for language runtimes used across BrikByte projects.  
Each file follows the same philosophy:

- Reproducible and cache-efficient builds.
- Secure, minimal final images.
- Ready for **CI/CD pipelines** (used in DEVOPS-CI-PIPE-003).
- Designed to integrate with **SBOM generation** and **evidence capture** for audit trails.

---

## 📦 Available Templates

| File | Language / Runtime | Build Stage | Final Stage | Key Features |
|------|--------------------|--------------|--------------|---------------|
| `Dockerfile.node` | Node.js 20 (Bookworm) | Multi-stage (`node:20-slim` → `distroless`) | Non-root | npm/yarn/pnpm caching, build + prune |
| `Dockerfile.python` | Python 3.11 (Slim) | Multi-stage (`python:3.11-slim` → `distroless`) | Non-root | pip caching, Poetry/pip/requirements auto-detect |
| `Dockerfile.java` | Java 21 (Temurin) | Multi-stage (build → jlink → JRE) | Non-root | Maven/Gradle autodetect, jlink minimal JRE |

---

## 🧱 Common Patterns

All Dockerfiles support:
- **Deterministic caching** with `--mount=type=cache,target=/root/.npm` or `/root/.m2`.
- **Fail-safe auto-builds:** If no project file (`package.json`, `pom.xml`, etc.) is found → prints `"noop"` and exits 0.
- **Artifact capture:** Built artifacts appear in `/out` for multi-stage COPY.
- **Security hardening:** Non-root runtime users, minimal packages, no compilers in final image.
- **Healthcheck integration:** All templates expose `/health` endpoint for readiness probes.

---

## 🚀 Usage Examples

### Node.js
```bash
docker build -f pipelines/docker/Dockerfile.node -t mynode:dev .
docker run --rm -p 3000:3000 mynode:dev
curl http://localhost:3000/health
```
### Python

```bash
docker build -f pipelines/docker/Dockerfile.python -t mypy:dev .
docker run --rm -p 8000:8000 mypy:dev
curl http://localhost:8000/health
```
### Java
```bash
docker build -f pipelines/docker/Dockerfile.java -t myjava:dev .
docker run --rm -p 8080:8080 myjava:dev
curl http://localhost:8080/health
```
---
## 🔐 Security & Compliance

Each pipeline stage emits SBOMs using **CycloneDX** (via `syft` or `maven-cyclonedx-plugin` in CI).
Evidence artifacts are published to `/artifacts/sbom/` and attached to the release workflow.

| Feature          | Purpose                         | 
|-----------------------------|--------------------------------------------|
| SBOM (CycloneDX JSON) | Dependency transparency |
| Non-root containers | Runtime safety |
| Minimal attack surface | No package manager / shell in final |
| Reproducibility | Locked base tags and plugin versions |
	
---
## 🧩 Integration with CI/CD
These templates are consumed by **DEVOPS-CI-PIPE-003** and **DEVOPS-CI-PIPE-004** reusable workflows.

```yaml
jobs:
  build-image:
    uses: org/.github/.github/workflows/docker-build-push.yml@v1
    with:
      dockerfile: pipelines/docker/Dockerfile.node
      image_name: mynode
```
Artifacts:
- `sbom.json` → uploaded to the run summary.
- `evidence.log` → build metadata for traceability.

---
## 🧠 Troubleshooting
| Symptom        | Likely Cause                        | Fix                                  |
|-----------------------------|--------------------------------------------|-----------------------------------------------------------|
| `No project file detected` | Missing `package.json`, `pom.xml`, etc. | Add correct file or ignore (noop expected). |
| `no main manifest attribute` | Missing `<mainClass>` in `pom.xml` | Add via `maven-shade-plugin` |
| `permission denied` | Running as non-root | Ensure correct WORKDIR and writable paths. |
| Long rebuilds | Context too large | Add `.dockerignore` to exclude non-essentials. | 

---
## 🧾 Versioning & Conventions
- Base images are pinned to major versions (Node 20, Python 3.11, Java 21).
- All templates support **CI reproducibility:** use digest-locked tags in production.
- Update cadence: reviewed quarterly or when CVEs require patch.

---
## 🧰 Future Enhancements
- Automated SBOM signing with Cosign.
- Multi-arch (amd64/arm64) builds.
- BuildKit provenance attestation pipeline.

---
**Maintainer:** DevOps Engineering
**Last updated:** $(date +%Y-%m-%d)
