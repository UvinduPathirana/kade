# syntax=docker/dockerfile:1.7
#
# Build context = this service directory; the repo's proto/ arrives as the named context "proto":
#   docker build --build-context proto=../../proto -t kade/promotion:dev .
# (compose.yaml passes it as additional_contexts.)

# ---------------------------------------------------------------- build (JDK + Gradle, glibc for protoc)
FROM gradle:8.14-jdk21 AS build
ENV GRADLE_USER_HOME=/cache/gradle
WORKDIR /src/services/app

# 1. Wrapper + build scripts first so dependency downloads are cached until they change.
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle gradle
COPY --from=proto buf.yaml /src/proto/buf.yaml
RUN --mount=type=cache,target=/cache/gradle ./gradlew --no-daemon -q dependencies >/dev/null

# 2. Contracts and sources.
COPY --from=proto . /src/proto
COPY src/main src/main
RUN --mount=type=cache,target=/cache/gradle ./gradlew --no-daemon -q bootJar \
 && java -Djarmode=tools -jar build/libs/app.jar extract --layers --destination /extracted

# ---------------------------------------------------------------- runtime (JRE only, non-root)
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app -h /app app
WORKDIR /app

# Layered: dependencies change rarely, the application layer on every commit.
COPY --from=build /extracted/dependencies/ ./
COPY --from=build /extracted/spring-boot-loader/ ./
COPY --from=build /extracted/snapshot-dependencies/ ./
COPY --from=build /extracted/application/ ./

# Class Data Sharing: a training run loads every class the app needs (context refresh only: no DB, Kafka or
# ports) and dumps them into app.jsa. Startup then maps the archive instead of parsing ~15k classes.
RUN java -XX:ArchiveClassesAtExit=app.jsa -Dspring.context.exit=onRefresh \
      -Dspring.flyway.enabled=false -Dkade.otel.logs.enabled=false -Dmanagement.tracing.enabled=false \
      -Dlogging.structured.format.console= -Dlogging.level.root=warn \
      -jar app.jar
# Files stay root-owned and read-only to the app user (no chown: it would copy every layer again).
USER app

# Small-container JVM (measured, see README "Memory"):
#  - SerialGC: one GC thread, lowest footprint for a ~100 MB heap; Min/MaxHeapFreeRatio let the heap shrink when idle
#  - heap = 50% of the container limit (128 MB of 256 MB); metaspace, code cache and direct memory capped
#  - ActiveProcessorCount=2: the JVM would otherwise size JIT, GC, ForkJoin and Netty event loops for every host core
#  - CDS archive mapped at its build-time address (ArchiveRelocationMode=0): relocation would copy it into ~30 MB of
#    private memory; falls back to relocating if the address is taken
#  - 512k thread stacks, two Netty arenas, exit on OOM so Compose restarts the container
ENV JAVA_OPTS="-XX:+UseSerialGC -XX:MaxRAMPercentage=50 -XX:InitialRAMPercentage=12 \
 -XX:MinHeapFreeRatio=10 -XX:MaxHeapFreeRatio=30 \
 -XX:MaxMetaspaceSize=128m -XX:ReservedCodeCacheSize=48m -XX:MaxDirectMemorySize=32m -Xss512k \
 -XX:ActiveProcessorCount=2 \
 -XX:SharedArchiveFile=app.jsa -XX:+UnlockDiagnosticVMOptions -XX:ArchiveRelocationMode=0 \
 -XX:+ExitOnOutOfMemoryError \
 -Dio.netty.allocator.numDirectArenas=2 -Dio.netty.allocator.numHeapArenas=2"

EXPOSE 50106 8106
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD wget -qO- "http://127.0.0.1:${HTTP_PORT:-8106}/health/ready" >/dev/null || exit 1
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
