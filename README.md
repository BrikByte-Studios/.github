## Container Build Strategy

BrikByteOS uses an opinionated container build strategy:

- **Local:** Docker (`docker build`, `docker run`, `make docker-build`, `make docker-run`)
- **CI (GitHub-hosted runners):** Kaniko (daemonless builds)
- **Security baselines:** Multi-stage images and non-root runtime users are mandatory for production.

See the full strategy in:

- `brik-pipe-docs/containers/container-build-strategy.md`
- ADR: `docs/adr/ADR-00X-container-build-strategy.md`

---
## Build Optimization & Caching

BrikByteOS CI templates ship with a cross-runtime caching strategy:

- Node.js, Python, JVM, Go, .NET dependency caches
- Central cache clean utility
- Weekly cache benchmark suite (cold vs warm builds)

📘 **Docs:** See [`BrikByte-Studios/brik-pipe-docs/cache/index.md`](BrikByte-Studios/brik-pipe-docs/cache/index.md)  
for:

- How cache keys are generated
- Cache reset / force-clear instructions
- Performance expectations
- Troubleshooting matrix & debug tips