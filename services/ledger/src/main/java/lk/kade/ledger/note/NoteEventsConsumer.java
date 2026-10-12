package lk.kade.ledger.note;

import java.util.UUID;
import lk.kade.ledger.kafka.EventDispatcher;
import lk.kade.ledger.kafka.MalformedEventException;
import lk.kade.ledger.kafka.ProtoEventHandler;
import lk.kade.ledger.money.Money;
import lk.kade.template.v1.NoteCreated;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Example consumer. The listener only hands records to {@link EventDispatcher} (decode by {@code eventType},
 * dedupe via {@code processed_events}, one transaction); the nested handler holds the business logic.
 * Consumer group = SERVICE_NAME (spring.kafka.consumer.group-id).
 */
@Component
public class NoteEventsConsumer {

    private final EventDispatcher dispatcher;

    public NoteEventsConsumer(EventDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    // idIsGroup = false: otherwise Spring uses the listener id as the consumer group instead of SERVICE_NAME.
    @KafkaListener(id = "note-events", idIsGroup = false, topics = "${kade.kafka.topics.note-events}")
    public void onRecord(ConsumerRecord<byte[], byte[]> record) {
        dispatcher.dispatch(record);
    }

    /** NoteCreated → add the amount to the per-currency total (optimistic locking; retried on conflict). */
    @Component
    static class NoteCreatedHandler extends ProtoEventHandler<NoteCreated> {

        private static final Logger log = LoggerFactory.getLogger(NoteCreatedHandler.class);

        private final NoteService notes;

        NoteCreatedHandler(NoteService notes) {
            super(NoteCreated.getDefaultInstance());
            this.notes = notes;
        }

        @Override
        protected void handle(UUID eventId, NoteCreated event) {
            if (!event.hasAmount()) {
                log.info("note {} has no amount; nothing to count", event.getNoteId());
                return; // still recorded in processed_events
            }
            Money amount;
            try {
                amount = Money.fromProto(event.getAmount());
            } catch (IllegalArgumentException e) {
                // Deterministic contract violation: retrying can't fix it, so skip straight to the DLQ.
                throw new MalformedEventException("NoteCreated " + event.getNoteId() + ": " + e.getMessage(), e);
            }
            NoteTotals totals = notes.addToTotals(amount);
            log.info("note {} counted: {} notes, total {}", event.getNoteId(), totals.noteCount(), totals.total());
        }
    }
}
