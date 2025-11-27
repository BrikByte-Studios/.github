## Container Build Strategy

BrikByteOS uses an opinionated container build strategy:

- **Local:** Docker (`docker build`, `docker run`, `make docker-build`, `make docker-run`)
- **CI (GitHub-hosted runners):** Kaniko (daemonless builds)
- **Security baselines:** Multi-stage images and non-root runtime users are mandatory for production.

See the full strategy in:

- `brik-pipe-docs/containers/container-build-strategy.md`
- ADR: `docs/adr/ADR-00X-container-build-strategy.md`