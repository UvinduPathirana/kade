package lk.kade.promotion.support;

import com.google.protobuf.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import lk.kade.promotion.error.ServiceException;

/** Calendar dates are Asia/Colombo (voucher and offer dates are inclusive local dates). */
public final class Colombo {

    public static final ZoneId ZONE = ZoneId.of("Asia/Colombo");

    private Colombo() {}

    public static LocalDate today(Clock clock) {
        return LocalDate.now(clock.withZone(ZONE));
    }

    /** Parses an ISO date ("2026-10-12"); blank or malformed is INVALID_ARGUMENT with the given reason. */
    public static LocalDate parseDate(String raw, String reason, String field) {
        if (raw == null || raw.isBlank()) {
            throw ServiceException.invalidArgument(reason, field + " is required");
        }
        try {
            return LocalDate.parse(raw.strip());
        } catch (DateTimeParseException e) {
            throw ServiceException.invalidArgument(reason, field + " must be an ISO date (YYYY-MM-DD)");
        }
    }

    public static Timestamp timestamp(Instant instant) {
        return Timestamp.newBuilder().setSeconds(instant.getEpochSecond()).setNanos(instant.getNano()).build();
    }

    public static Instant instant(Timestamp ts) {
        return Instant.ofEpochSecond(ts.getSeconds(), ts.getNanos());
    }
}
