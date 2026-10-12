package lk.kade.ledger.note;

import com.google.protobuf.Timestamp;
import java.time.Instant;
import java.util.UUID;
import lk.kade.ledger.money.Money;

public record Note(UUID id, String text, Money amount, String createdBy, Instant createdAt) {

    public lk.kade.template.v1.Note toProto() {
        return lk.kade.template.v1.Note.newBuilder()
                .setId(id.toString())
                .setText(text)
                .setAmount(amount.toProto())
                .setCreatedAt(toTimestamp(createdAt))
                .build();
    }

    static Timestamp toTimestamp(Instant t) {
        return Timestamp.newBuilder().setSeconds(t.getEpochSecond()).setNanos(t.getNano()).build();
    }
}
