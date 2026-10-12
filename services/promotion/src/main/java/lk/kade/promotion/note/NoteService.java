package lk.kade.promotion.note;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lk.kade.promotion.error.ServiceException;
import lk.kade.promotion.money.Money;
import lk.kade.promotion.outbox.OutboxWriter;
import lk.kade.promotion.outbox.UuidV7;
import lk.kade.template.v1.NoteCreated;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Domain logic. Transport-agnostic: the gRPC layer maps requests in and responses out. */
@Service
public class NoteService {

    public static final String AGGREGATE_TYPE = "note"; // -> topic kade.note.events
    public static final String NOTE_NOT_FOUND = "NOTE_NOT_FOUND";
    public static final String NOTE_TEXT_REQUIRED = "NOTE_TEXT_REQUIRED";
    public static final String NOTE_AMOUNT_INVALID = "NOTE_AMOUNT_INVALID";

    private final NoteRepository notes;
    private final NoteTotalsRepository totals;
    private final OutboxWriter outbox;
    private final Clock clock;

    public NoteService(NoteRepository notes, NoteTotalsRepository totals, OutboxWriter outbox, Clock clock) {
        this.notes = notes;
        this.totals = totals;
        this.outbox = outbox;
        this.clock = clock;
    }

    /** Note row + outbox row in one transaction (the caller's, when called through idempotency). */
    @Transactional
    public Note create(String text, Money amount, String createdBy) {
        if (text == null || text.isBlank()) {
            throw ServiceException.invalidArgument(NOTE_TEXT_REQUIRED, "text is required");
        }
        if (amount.isNegative()) {
            throw ServiceException.invalidArgument(NOTE_AMOUNT_INVALID, "amount must not be negative");
        }
        // Postgres stores microseconds; truncate so the value we return equals the value we read back later.
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Note note = new Note(UuidV7.next(), text.strip(), amount, createdBy, now);
        notes.insert(note);
        outbox.append(AGGREGATE_TYPE, note.id().toString(), NoteCreated.newBuilder()
                .setNoteId(note.id().toString())
                .setText(note.text())
                .setAmount(amount.toProto())
                .setCreatedAt(Note.toTimestamp(now))
                .build());
        return note;
    }

    @Transactional(readOnly = true)
    public Note get(UUID id) {
        return notes.findById(id)
                .orElseThrow(() -> ServiceException.notFound(NOTE_NOT_FOUND, "note " + id + " not found"));
    }

    /** Side effect of the NoteCreated consumer: optimistic read-decide-write on the per-currency total. */
    @Transactional
    public NoteTotals addToTotals(Money amount) {
        totals.createIfMissing(amount.currency());
        NoteTotals current = totals.find(amount.currency()).orElseThrow();
        NoteTotals next = current.add(amount);
        totals.update(next);
        return next;
    }
}
