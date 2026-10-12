package lk.kade.promotion.kafka;

import com.google.protobuf.Message;
import com.google.protobuf.Parser;
import java.util.UUID;

/**
 * Handles one protobuf event type. Subclass it as a Spring bean and {@link EventDispatcher} routes records whose
 * {@code eventType} header equals {@link #eventType()} to it. {@link #handle} runs inside the dispatcher's
 * transaction, after the event id was recorded in {@code processed_events}: write side effects with the same
 * DataSource and they commit (or roll back) together with the dedup row.
 */
public abstract class ProtoEventHandler<T extends Message> {

    private final String eventType;
    private final Parser<T> parser;

    @SuppressWarnings("unchecked")
    protected ProtoEventHandler(T defaultInstance) {
        this.eventType = defaultInstance.getDescriptorForType().getFullName();
        this.parser = (Parser<T>) defaultInstance.getParserForType();
    }

    public final String eventType() { return eventType; }

    final Parser<T> parser() { return parser; }

    protected abstract void handle(UUID eventId, T event);
}
