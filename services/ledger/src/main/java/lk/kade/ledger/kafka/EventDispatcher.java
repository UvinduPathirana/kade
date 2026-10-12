package lk.kade.ledger.kafka;

import com.google.protobuf.InvalidProtocolBufferException;
import com.google.protobuf.Message;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.Header;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Decodes outbox events (headers {@code id}, {@code eventType}; value = raw protobuf bytes) and runs the matching
 * {@link ProtoEventHandler} exactly once per event id: the {@code processed_events} insert and the handler's side
 * effects share one transaction, so a redelivery after a crash either finds the id (skip) or redoes everything.
 */
@Component
public class EventDispatcher {

    public static final String HEADER_ID = "id";
    public static final String HEADER_EVENT_TYPE = "eventType";

    private static final Logger log = LoggerFactory.getLogger(EventDispatcher.class);

    private final JdbcClient jdbc;
    private final Map<String, ProtoEventHandler<?>> handlers;

    public EventDispatcher(JdbcClient jdbc, List<ProtoEventHandler<?>> handlers) {
        this.jdbc = jdbc;
        this.handlers = handlers.stream().collect(Collectors.toMap(ProtoEventHandler::eventType, Function.identity()));
    }

    @Transactional
    public void dispatch(ConsumerRecord<?, byte[]> record) {
        String eventType = header(record, HEADER_EVENT_TYPE);
        ProtoEventHandler<?> handler = eventType == null ? null : handlers.get(eventType);
        if (handler == null) {
            // Topics carry every event type of an aggregate; ignore the ones this service doesn't care about.
            log.debug("ignoring event type {} at {}-{}@{}", eventType, record.topic(), record.partition(), record.offset());
            return;
        }
        UUID eventId = eventId(record);
        int inserted = jdbc.sql("INSERT INTO processed_events (event_id) VALUES (:id) ON CONFLICT DO NOTHING")
                .param("id", eventId)
                .update();
        if (inserted == 0) {
            log.info("duplicate event {} ({}) skipped", eventId, eventType);
            return;
        }
        invoke(handler, eventId, record.value());
    }

    private static <T extends Message> void invoke(ProtoEventHandler<T> handler, UUID eventId, byte[] payload) {
        T event;
        try {
            event = handler.parser().parseFrom(payload == null ? new byte[0] : payload);
        } catch (InvalidProtocolBufferException e) {
            throw new MalformedEventException("cannot decode " + handler.eventType(), e);
        }
        handler.handle(eventId, event);
    }

    private static UUID eventId(ConsumerRecord<?, ?> record) {
        String raw = header(record, HEADER_ID);
        if (raw == null) {
            throw new MalformedEventException("missing '" + HEADER_ID + "' header");
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw new MalformedEventException("'" + HEADER_ID + "' header is not a UUID: " + raw, e);
        }
    }

    /** Last value of a header as a string; tolerates JSON-quoted values from Kafka Connect header converters. */
    static String header(ConsumerRecord<?, ?> record, String name) {
        Header h = record.headers().lastHeader(name);
        if (h == null || h.value() == null) {
            return null;
        }
        String v = new String(h.value(), StandardCharsets.UTF_8).trim();
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            v = v.substring(1, v.length() - 1);
        }
        return v;
    }
}
