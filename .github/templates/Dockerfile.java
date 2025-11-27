# BrikByteOS Canonical Java (Spring Boot) Dockerfile Template
# Task: PIPE-CONTAINER-DOCKER-BUILD-002

# syntax=docker/dockerfile:1.7

##
## 1) Build Stage
##
ARG JAVA_VERSION=17
ARG APP_VERSION=dev
ARG GIT_COMMIT=local
ARG APP_DIR=/workspace

FROM eclipse-temurin:${JAVA_VERSION}-jdk-jammy AS builder

WORKDIR ${APP_DIR}

# Copy build descriptors first for caching
COPY pom.xml mvnw* ./
COPY .mvn .mvn

# Download dependencies (no source yet, for better caching)
RUN ./mvnw -B -ntp dependency:go-offline

# Copy source
COPY src ./src

# Build fat jar
RUN ./mvnw -B -ntp clean package -DskipTests=false

##
## 2) Runtime Stage
##
FROM eclipse-temurin:${JAVA_VERSION}-jre-jammy AS runtime

ARG APP_VERSION=dev
ARG GIT_COMMIT=local
ARG APP_DIR=/app

# Create non-root user
RUN useradd --create-home --shell /sbin/nologin appuser

WORKDIR ${APP_DIR}

# Copy packaged JAR from builder
# Adjust jar name pattern to your app's artifactId/version if needed.
COPY --from=builder /workspace/target/*.jar ./app.jar

# Standard OCI labels
LABEL org.opencontainers.image.title="BrikByte Java Service" \
      org.opencontainers.image.description="Canonical Java runtime image for BrikByteOS services" \
      org.opencontainers.image.source="https://github.com/BrikByte-Studios/<service-repo>" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.licenses="MIT"

USER appuser

EXPOSE 8080

# HEALTHCHECK placeholder – Spring Boot /actuator/health for example
# HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
#   CMD curl -f http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["java","-jar","./app.jar"]
