package lk.kade.promotion.note;

import java.util.Optional;
import lk.kade.promotion.error.OptimisticLockException;
import lk.kade.promotion.money.Money;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Optimistic locking, explicitly: read the row with its version, decide in Java, then
 * {@code UPDATE ... SET version = version + 1 WHERE currency = ? AND version = ?}. Zero rows means someone else won
 * the race; throw {@link OptimisticLockException} and let the caller retry the whole read-decide-write.
 *
 * <p>Prefer a single atomic {@code UPDATE ... SET total = total + ?} when there is no invariant to check in code;
 * use this pattern when the decision needs the current value (budget caps, balance floors).
 */
@Repository
public class NoteTotalsRepository {

    private final JdbcClient jdbc;

    public NoteTotalsRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<NoteTotals> find(String currency) {
        return jdbc.sql("SELECT total_minor, note_count, version FROM note_totals WHERE currency = :currency")
                .param("currency", currency)
                .query((rs, n) -> new NoteTotals(
                        Money.of(rs.getLong("total_minor"), currency), rs.getLong("note_count"), rs.getLong("version")))
                .optional();
    }

    /** Inserts a zero row if missing; returns true if this call created it. */
    public boolean createIfMissing(String currency) {
        return jdbc.sql("INSERT INTO note_totals (currency) VALUES (:currency) ON CONFLICT DO NOTHING")
                .param("currency", currency)
                .update() == 1;
    }

    /** Writes {@code next} if the row is still at {@code next.version()}; the stored version becomes +1. */
    public void update(NoteTotals next) {
        int rows = jdbc.sql("""
                UPDATE note_totals
                   SET total_minor = :total, note_count = :count, version = version + 1, updated_at = now()
                 WHERE currency = :currency AND version = :version
                """)
                .param("total", next.total().amountMinor())
                .param("count", next.noteCount())
                .param("currency", next.total().currency())
                .param("version", next.version())
                .update();
        if (rows != 1) {
            throw new OptimisticLockException("note_totals", next.total().currency(), next.version());
        }
    }
}
