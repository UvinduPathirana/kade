import com.google.protobuf.gradle.id

plugins {
    java
    id("org.springframework.boot") version "3.5.16"
    id("io.spring.dependency-management") version "1.1.7"
    id("com.google.protobuf") version "0.9.5"
}

group = "lk.kade"
version = "0.0.1"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

repositories { mavenCentral() }

// Spring gRPC 0.12 is the line built for Spring Boot 3.5 (1.x needs Boot 4). Its BOM pins grpc-java and protobuf.
val springGrpcVersion = "0.12.0"
val grpcVersion = "1.76.0"
val protobufVersion = "4.32.1"

dependencyManagement {
    imports { mavenBom("org.springframework.grpc:spring-grpc-dependencies:$springGrpcVersion") }
}

// Contracts live in <repo>/proto. Walk up until we find the buf module so the same build works for
// services/payment (3 levels deep), services/<name> (2 levels) and the Docker build (/repo/proto).
val protoRoot: File = (findProperty("protoRoot") as String?)?.let(::file)
    ?: generateSequence(projectDir) { it.parentFile }
        .map { it.resolve("proto") }
        .firstOrNull { it.resolve("buf.yaml").isFile }
    ?: error("Cannot find the repo's proto/ directory (looked for proto/buf.yaml above $projectDir); pass -PprotoRoot=...")

// Only the packages this service uses. A new service adds its own package (and any it calls) here.
val protoPackages = listOf("kade/common/v1", "kade/payment/v1", "kade/dispatch/v1")

// The protobuf plugin compiles every .proto under its source dirs (include/exclude filters are ignored), so stage
// just the packages we need. Imports between them resolve inside the staged copy.
val stageProtos by tasks.registering(Sync::class) {
    from(protoRoot) { protoPackages.forEach { include("$it/*.proto") } }
    into(layout.buildDirectory.dir("kade-proto"))
}

sourceSets {
    main {
        proto { srcDir(stageProtos) }
    }
}

protobuf {
    protoc { artifact = "com.google.protobuf:protoc:$protobufVersion" }
    plugins {
        id("grpc") { artifact = "io.grpc:protoc-gen-grpc-java:$grpcVersion" }
    }
    generateProtoTasks {
        all().forEach { it.plugins { id("grpc") { option("@generated=omit") } } }
    }
}

dependencies {
    // gRPC server (Netty, health + reflection services, Micrometer observation interceptor)
    implementation("org.springframework.grpc:spring-grpc-server-spring-boot-starter")
    implementation("io.grpc:grpc-services")
    implementation("com.google.api.grpc:proto-google-common-protos") // google.rpc.ErrorInfo

    // HTTP side: actuator only (health, metrics)
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")

    // Postgres with explicit SQL (JdbcClient) and Flyway
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")

    // Kafka
    implementation("org.springframework.kafka:spring-kafka")

    // Observability: Micrometer -> OpenTelemetry (OTLP) for traces/metrics/logs, Prometheus scrape at /metrics
    implementation("io.micrometer:micrometer-tracing-bridge-otel")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")
    implementation("io.micrometer:micrometer-registry-prometheus")
    implementation("io.micrometer:micrometer-registry-otlp")
    implementation("io.opentelemetry.instrumentation:opentelemetry-logback-appender-1.0:2.15.0-alpha")
    implementation("net.ttddyy.observation:datasource-micrometer-spring-boot:1.5.0")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.grpc:grpc-inprocess")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.compilerArgs.addAll(listOf("-parameters", "-Xlint:all,-processing,-serial", "-Werror"))
}

// Unit tests: `gradle test` (no infrastructure). Integration tests: `gradle integrationTest` against the
// shared Compose stack (Postgres + Kafka). CI runs `test` alone; `check` does not pull in integration tests.
@Suppress("UnstableApiUsage")
testing {
    suites {
        val test by getting(JvmTestSuite::class) { useJUnitJupiter() }
        register<JvmTestSuite>("integrationTest") {
            useJUnitJupiter()
            dependencies {
                implementation(project())
                implementation("org.springframework.boot:spring-boot-starter-test")
                implementation("org.springframework.grpc:spring-grpc-test")
                runtimeOnly("org.junit.platform:junit-platform-launcher")
            }
            targets.all {
                testTask.configure {
                    shouldRunAfter(test)
                    // Integration tests share one Postgres/Kafka: run serially. Builds run in Docker on the `kade`
                    // network (scripts/java-build.sh), so default to in-network addresses; env vars override.
                    maxParallelForks = 1
                    mapOf(
                        "DATABASE_URL" to "postgres://payment:payment@postgres:5432/payment",
                        "KAFKA_BROKERS" to "kafka:9092",
                        "OTEL_EXPORTER_OTLP_ENDPOINT" to "http://otel:4318",
                        "CONNECT_URL" to "http://connect:8083",
                    ).forEach { (name, default) -> environment(name, System.getenv(name) ?: default) }
                }
            }
        }
    }
}

configurations["integrationTestImplementation"].extendsFrom(configurations.implementation.get())
configurations["integrationTestRuntimeOnly"].extendsFrom(configurations.runtimeOnly.get())

tasks.withType<Test> {
    maxHeapSize = "384m"
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

tasks.bootJar { archiveFileName = "app.jar" }
tasks.jar { archiveClassifier = "plain" } // used by the integrationTest suite (project dependency)
