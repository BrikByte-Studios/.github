# BrikPipe Integration Test Runner (Multi-Stage)
# ----------------------------------------------
# Stage 1 (builder):
#   - Base: mcr.microsoft.com/dotnet/sdk (dotnet SDK pre-installed)
#   - Install Node, Python (+venv), Java, Go tooling.
#   - Always create /venv, and install service-level test deps (npm, pip) in SERVICE_WORKDIR.
#
# Stage 2 (runner):
#   - Base: mcr.microsoft.com/dotnet/sdk (dotnet CLI available for tests).
#   - Install minimal runtime deps for Node, Python, Java, Go.
#   - Copy in installed tools, venv, and project files.
#   - Copy run-integration-tests.sh helper script.
#   - Use the script as ENTRYPOINT.
#
# This image is language-agnostic and controlled via environment variables
# supplied by the CI workflow (TEST_LANGUAGE, TEST_COMMAND, SERVICE_WORKDIR, etc.).
#

############################
# Stage 1: Builder
############################
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder

# Service workdir inside the repo, e.g. "node-api-example" or "python-api-example".
# The workflow passes this via --build-arg SERVICE_WORKDIR=...
ARG SERVICE_WORKDIR="."

# Install base tooling:
# - Java JDK for Java tests
# - Python (with pip + venv) for Python tests
# - Go toolchain for Go tests
# - curl/wget/gnupg/etc. for installing Node.js
# - netcat for DB readiness checks in scripts (if needed in build phase)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg \
    lsb-release \
    netcat-openbsd \
    git \
    openjdk-17-jdk \
    python3 \
    python3-pip \
    python3-venv \
    golang-go \
    gcc \
    # (optional) psql in builder in case future scripts use it here
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x (for Node-based tests)
RUN set -eux; \
    wget -O- https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy entire repo as build context; the runner expects to see the same project
# structure as the service repo (for package.json, requirements.txt, mvnw, etc.).
COPY . /workspace

# Install language-specific test dependencies where applicable.
# Priority:
#   - If SERVICE_WORKDIR has its own package.json / requirements.txt, install there.
#   - Otherwise, fall back to repo root (for monorepo-style setups).
# NOTE:
#   - We ALWAYS create /venv so that COPY --from=builder /venv /venv
#     in the runner stage never fails, even for Java-only services.
RUN set -eux; \
    echo "[builder] SERVICE_WORKDIR='${SERVICE_WORKDIR}'"; \
    \
    # ----------------------------------------------------
    # Node.js deps (only if package.json exists somewhere)
    # ----------------------------------------------------
    if [ -n "${SERVICE_WORKDIR}" ] && [ -f "${SERVICE_WORKDIR}/package.json" ]; then \
      echo "[builder] Installing Node dependencies in ${SERVICE_WORKDIR}..."; \
      cd "${SERVICE_WORKDIR}"; \
      npm install --ignore-scripts; \
      cd - >/dev/null; \
    elif [ -f package.json ]; then \
      echo "[builder] Installing Node dependencies in repo root..."; \
      npm install --ignore-scripts; \
    else \
      echo "[builder] No package.json found; skipping Node dependencies."; \
    fi; \
    \
    # ----------------------------------------------------
    # Python deps — always create a venv, then conditionally pip install
    # This avoids PEP 668 "externally managed" issues AND guarantees /venv exists.
    # ----------------------------------------------------
    echo "[builder] Creating Python virtualenv at /venv (even if no requirements.txt)..."; \
    python3 -m venv /venv; \
    . /venv/bin/activate; \
    if [ -n "${SERVICE_WORKDIR}" ] && [ -f "${SERVICE_WORKDIR}/requirements.txt" ]; then \
      echo "[builder] Installing Python deps from ${SERVICE_WORKDIR}/requirements.txt ..."; \
      pip install --no-cache-dir -r "${SERVICE_WORKDIR}/requirements.txt"; \
    elif [ -f requirements.txt ]; then \
      echo "[builder] Installing Python deps from requirements.txt ..."; \
      pip install --no-cache-dir -r requirements.txt; \
    else \
      echo "[builder] No requirements.txt found; Python venv created but no deps installed."; \
    fi

############################
# Stage 2: Runtime (Test Runner)
############################
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS runner

# Minimal runtime dependencies for tests and health checks:
# - curl/netcat for HTTP/TCP health checks
# - Java JRE for Java tests
# - Python for Python tests (venv copied from builder)
# - Go toolchain for Go tests
# - Node.js for Node tests
# - postgresql-client (psql) for DB fixture loader scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    netcat-openbsd \
    openjdk-17-jre-headless \
    python3 \
    python3-venv \
    golang-go \
    maven \
    gradle \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x again in runner stage (runtime needs node as well)
RUN set -eux; \
    wget -O- https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy project files and installed tooling from builder.
COPY --from=builder /workspace /workspace
COPY --from=builder /usr/local /usr/local

# Copy Python virtualenv from builder so pytest + deps are available.
# /venv is now guaranteed to exist because we always created it in builder.
COPY --from=builder /venv /venv
ENV VIRTUAL_ENV=/venv
ENV PATH="/venv/bin:${PATH}"

# Copy the integration test runner script from the repo.
# NOTE:
#   - Build context is the repo root (CI uses:
#       docker build -f .github/templates/integration-test-runner.Dockerfile .)
#   - Script paths in repo:
#       .github/scripts/run-integration-tests.sh
#       .github/scripts/wait-for-health.sh  <-- new shared health helper
COPY .github/scripts/run-integration-tests.sh /usr/local/bin/run-integration-tests.sh
COPY .github/scripts/wait-for-health.sh      /usr/local/bin/wait-for-health.sh

RUN chmod +x /usr/local/bin/run-integration-tests.sh \
             /usr/local/bin/wait-for-health.sh

ENTRYPOINT ["/usr/local/bin/run-integration-tests.sh"]

