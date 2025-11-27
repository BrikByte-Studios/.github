# BrikByteOS Canonical Go Dockerfile Template
# Task: PIPE-CONTAINER-DOCKER-BUILD-002

# syntax=docker/dockerfile:1.7

##
## 1) Build Stage
##
ARG GO_VERSION=1.22
ARG APP_VERSION=dev
ARG GIT_COMMIT=local
ARG APP_DIR=/src

FROM golang:${GO_VERSION}-alpine AS builder

# Enable Go modules
ENV CGO_ENABLED=0 GOOS=linux

WORKDIR ${APP_DIR}

# Install git for go get if needed
RUN apk add --no-cache git

# Copy go module files first
COPY go.mod go.sum ./
RUN go mod download

# Copy rest of the source
COPY . .

# Build a static binary
RUN go build -ldflags="-s -w -X main.version=${APP_VERSION} -X main.commit=${GIT_COMMIT}" \
    -o /app/server ./...

##
## 2) Runtime Stage
##
# Distroless or scratch is ideal; alpine is also acceptable.
FROM gcr.io/distroless/static:nonroot AS runtime
# Alternative (less strict, more debuggable):
# FROM alpine:3.20 AS runtime

ARG APP_VERSION=dev
ARG GIT_COMMIT=local

WORKDIR /app

COPY --from=builder /app/server ./server

# Standard OCI labels
LABEL org.opencontainers.image.title="BrikByte Go Service" \
      org.opencontainers.image.description="Canonical Go runtime image for BrikByteOS services" \
      org.opencontainers.image.source="https://github.com/BrikByte-Studios/<service-repo>" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.licenses="MIT"

# Distroless image already runs as nonroot; if using alpine:
# RUN adduser -D -H -s /sbin/nologin appuser && \
#     chown -R appuser:appuser /app && \
#     USER appuser
USER nonroot:nonroot

EXPOSE 8080

# HEALTHCHECK placeholder – for distroless, you'd often rely on k8s-level probes.
# Example for alpine-based image:
# HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
#   CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["./server"]
