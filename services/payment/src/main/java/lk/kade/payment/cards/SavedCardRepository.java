package lk.kade.payment.cards;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class SavedCardRepository {

    private static final String COLUMNS = """
            id, customer_id, brand, last4, expiry_month, expiry_year, holder_name, psp_token, fingerprint,
            added_at, removed_at""";

    private final JdbcClient jdbc;

    public SavedCardRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<SavedCard> listLive(String customerId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM saved_cards WHERE customer_id = :c AND removed_at IS NULL ORDER BY added_at, id")
                .param("c", customerId)
                .query(SavedCardRepository::map)
                .list();
    }

    /** Any card, removed or not (payments keep pointing at removed cards). */
    public Optional<SavedCard> find(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM saved_cards WHERE id = :id")
                .param("id", id)
                .query(SavedCardRepository::map)
                .optional();
    }

    /** @return false when a live card with the same fingerprint already exists for the customer */
    public boolean insert(SavedCard card) {
        return jdbc.sql("""
                INSERT INTO saved_cards (id, customer_id, brand, last4, expiry_month, expiry_year, holder_name,
                                         psp_token, fingerprint, added_at)
                VALUES (:id, :customer, :brand, :last4, :month, :year, :holder, :token, :fingerprint, :addedAt)
                ON CONFLICT DO NOTHING
                """)
                .param("id", card.id())
                .param("customer", card.customerId())
                .param("brand", card.brand())
                .param("last4", card.last4())
                .param("month", card.expiryMonth())
                .param("year", card.expiryYear())
                .param("holder", card.holderName())
                .param("token", card.pspToken())
                .param("fingerprint", card.fingerprint())
                .param("addedAt", Timestamp.from(card.addedAt()))
                .update() == 1;
    }

    public boolean markRemoved(UUID id, String customerId, Instant at) {
        return jdbc.sql("""
                UPDATE saved_cards SET removed_at = :at
                 WHERE id = :id AND customer_id = :c AND removed_at IS NULL
                """)
                .param("at", Timestamp.from(at)).param("id", id).param("c", customerId)
                .update() == 1;
    }

    // --- setup sessions ------------------------------------------------------------------------------------------

    public void insertSession(UUID id, String customerId, String clientSecret, Instant createdAt, Instant expiresAt) {
        jdbc.sql("""
                INSERT INTO card_setup_sessions (id, customer_id, client_secret, created_at, expires_at)
                VALUES (:id, :c, :secret, :created, :expires)
                """)
                .param("id", id).param("c", customerId).param("secret", clientSecret)
                .param("created", Timestamp.from(createdAt)).param("expires", Timestamp.from(expiresAt))
                .update();
    }

    /** Marks the session used if it belongs to the customer, is unused and has not expired. */
    public boolean useSession(UUID id, String customerId, Instant now) {
        return jdbc.sql("""
                UPDATE card_setup_sessions SET used_at = :now
                 WHERE id = :id AND customer_id = :c AND used_at IS NULL AND expires_at > :now
                """)
                .param("now", Timestamp.from(now)).param("id", id).param("c", customerId)
                .update() == 1;
    }

    private static SavedCard map(ResultSet rs, int row) throws SQLException {
        Timestamp removed = rs.getTimestamp("removed_at");
        return new SavedCard(
                rs.getObject("id", UUID.class),
                rs.getString("customer_id"),
                rs.getString("brand"),
                rs.getString("last4"),
                rs.getInt("expiry_month"),
                rs.getInt("expiry_year"),
                rs.getString("holder_name"),
                rs.getString("psp_token"),
                rs.getString("fingerprint"),
                rs.getTimestamp("added_at").toInstant(),
                removed == null ? null : removed.toInstant());
    }
}
