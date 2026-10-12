package lk.kade.promotion.outbox;

import com.google.protobuf.Message;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Appends an event to the outbox. {@code MANDATORY}: it must join the transaction that makes the business change,
 * so either both commit or neither does. Debezium publishes the row to {@code kade.<aggregateType>.events}, keyed by
 * {@code aggregateId}, with headers {@code id}, {@code eventType} and {@code traceparent}.
 * Never publish to Kafka directly from a request handler.
 */
@Component
public class OutboxWriter {

    private final JdbcClient jdbc;
    private final TraceContext traceContext;

    public OutboxWriter(JdbcClient jdbc, TraceContext traceContext) {
        this.jdbc = jdbc;
        this.traceContext = traceContext;
    }

    /** @return the event id (also the consumers' deduplication key) */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID append(String aggregateType, String aggregateId, Message event) {
        UUID id = UuidV7.next();
        jdbc.sql("""
                INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload, traceparent)
                VALUES (:id, :aggregateType, :aggregateId, :type, :payload, :traceparent)
                """)
                .param("id", id)
                .param("aggregateType", aggregateType)
                .param("aggregateId", aggregateId)
                .param("type", event.getDescriptorForType().getFullName())
                .param("payload", event.toByteArray())
                .param("traceparent", traceContext.currentTraceparent())
                .update();
        return id;
    }
}
