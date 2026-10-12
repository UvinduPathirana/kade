package lk.kade.promotion;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import lk.kade.template.v1.TemplateServiceGrpc;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.grpc.test.LocalGrpcPort;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Runs the whole application against the SHARED stack (no Testcontainers): Postgres database promotion and
 * Kafka. Addresses come from DATABASE_URL / KAFKA_BROKERS (defaults: localhost). A separate SERVICE_NAME gives the
 * tests their own consumer group, so a running template container doesn't steal their records; every test uses
 * fresh ids and its own currency code so runs never see each other's rows.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "kade.service-name=promotion-it",
        "spring.grpc.server.port=0",
        "logging.structured.format.console=",   // plain logs in test output
        "kade.otel.logs.enabled=false",
        "management.tracing.sampling.probability=1.0",
})
@AutoConfigureObservability // Boot tests disable tracing by default; we assert traceparent and metrics
public abstract class IntegrationTestBase {

    @LocalGrpcPort
    protected int grpcPort;

    @Autowired
    protected JdbcClient jdbc;

    protected ManagedChannel channel;

    @BeforeEach
    void openChannel() {
        channel = ManagedChannelBuilder.forAddress("localhost", grpcPort).usePlaintext().build();
    }

    @AfterEach
    void closeChannel() throws InterruptedException {
        channel.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
    }

    protected TemplateServiceGrpc.TemplateServiceBlockingStub stub(String userId) {
        Metadata md = new Metadata();
        if (userId != null) {
            md.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), userId);
            md.put(Metadata.Key.of("x-roles", Metadata.ASCII_STRING_MARSHALLER), "customer");
        }
        return TemplateServiceGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md))
                .withDeadlineAfter(5, TimeUnit.SECONDS);
    }

    /**
     * A random currency code (never LKR) whose totals row is cleared first, so each test owns its totals even
     * though the shared database keeps rows from earlier runs.
     */
    protected String uniqueCurrency() {
        ThreadLocalRandom r = ThreadLocalRandom.current();
        String code;
        do {
            code = "" + (char) ('A' + r.nextInt(26)) + (char) ('A' + r.nextInt(26)) + (char) ('A' + r.nextInt(26));
        } while (code.equals("LKR"));
        jdbc.sql("DELETE FROM note_totals WHERE currency = :c").param("c", code).update();
        return code;
    }

    protected static lk.kade.common.v1.Money money(long minor, String currency) {
        return lk.kade.common.v1.Money.newBuilder().setAmountMinor(minor).setCurrency(currency).build();
    }
}
