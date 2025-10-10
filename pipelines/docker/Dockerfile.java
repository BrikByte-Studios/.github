# --- Build stage ---
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /src
COPY . .
RUN apt-get update && apt-get install -y --no-install-recommends maven && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.m2,sharing=locked mvn -q -B -DskipTests package
RUN mkdir -p /out && cp target/app.jar /out/app.jar

# Create minimal JRE and include jdk.httpserver (required for HttpServer)
RUN jlink \
    --add-modules java.base,java.logging,jdk.httpserver \
    --strip-debug --no-man-pages --no-header-files \
    --output /opt/jre

# --- Runtime stage (unchanged) ---
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd -m app
USER app
COPY --from=builder /opt/jre /opt/jre
ENV PATH="/opt/jre/bin:$PATH"
COPY --from=builder /out/app.jar /app/app.jar
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD [ "bash", "-lc", "exec 3<>/dev/tcp/127.0.0.1/8080 || exit 1" ]
CMD ["java", "-jar", "/app/app.jar"]
