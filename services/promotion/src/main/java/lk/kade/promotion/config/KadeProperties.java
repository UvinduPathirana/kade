package lk.kade.promotion.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Service settings bound from the CONVENTIONS environment variables (see application.yaml for the mapping).
 *
 * @param serviceName     SERVICE_NAME; also the Kafka consumer group and the OTel service name
 * @param databaseUrl     DATABASE_URL in the shared {@code postgres://user:pass@host:port/db} form
 * @param grpc            server-side gRPC policy
 * @param kafka           topics and retry policy
 */
@ConfigurationProperties("kade")
public record KadeProperties(
        String serviceName,
        String databaseUrl,
        @DefaultValue Grpc grpc,
        @DefaultValue Kafka kafka) {

    /**
     * @param defaultDeadline deadline applied to incoming calls that arrive without one, and to outgoing calls
     * @param maxDeadline     incoming deadlines longer than this are clamped (protects pools from slow callers)
     */
    public record Grpc(
            @DefaultValue("2s") Duration defaultDeadline,
            @DefaultValue("10s") Duration maxDeadline) {}

    /**
     * @param attempts        total delivery attempts before a record goes to {@code <topic>.dlq} (CONVENTIONS: 5)
     * @param initialBackoff  first retry delay; doubles up to {@code maxBackoff}
     */
    public record Kafka(
            @DefaultValue("5") int attempts,
            @DefaultValue("200ms") Duration initialBackoff,
            @DefaultValue("5s") Duration maxBackoff,
            @DefaultValue("5s") Duration healthTimeout) {}
}
