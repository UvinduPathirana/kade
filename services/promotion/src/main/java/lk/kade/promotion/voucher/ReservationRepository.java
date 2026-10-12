package lk.kade.promotion.voucher;

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
public class ReservationRepository {

    private static final String COLUMNS =
            "id, code, customer_id, order_id, discount_minor, currency, funded_by, status, reason, expires_at";

    private final JdbcClient jdbc;

    public ReservationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(Reservation r) {
        jdbc.sql("""
                INSERT INTO promo_reservations (id, code, customer_id, order_id, discount_minor, currency, funded_by,
                    status, reason, expires_at)
                VALUES (:id, :code, :customer, :order, :discount, :currency, :fundedBy, :status, :reason, :expiresAt)
                """)
                .param("id", r.id())
                .param("code", r.code())
                .param("customer", r.customerId())
                .param("order", r.orderId())
                .param("discount", r.discountMinor())
                .param("currency", r.currency())
                .param("fundedBy", r.fundedBy())
                .param("status", r.status())
                .param("reason", r.reason())
                .param("expiresAt", Timestamp.from(r.expiresAt()))
                .update();
    }

    /** Locks the row: release, redeem and expiry of one reservation serialise on it. */
    public Optional<Reservation> lock(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM promo_reservations WHERE id = :id FOR UPDATE")
                .param("id", id)
                .query(ReservationRepository::map)
                .optional();
    }

    public List<Reservation> lockForOrder(String orderId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM promo_reservations WHERE order_id = :order ORDER BY created_at FOR UPDATE")
                .param("order", orderId)
                .query(ReservationRepository::map)
                .list();
    }

    public Optional<Reservation> findHeld(String orderId, String code) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM promo_reservations WHERE order_id = :order AND code = :code AND status = 'held'")
                .param("order", orderId)
                .param("code", code)
                .query(ReservationRepository::map)
                .optional();
    }

    /** Held or redeemed uses of a code by one customer, not counting {@code exceptOrderId}. */
    public int usesByCustomer(String customerId, String code, String exceptOrderId) {
        return jdbc.sql("""
                SELECT count(*) FROM promo_reservations
                 WHERE customer_id = :customer AND code = :code AND status IN ('held', 'redeemed') AND order_id <> :order
                """)
                .param("customer", customerId)
                .param("code", code)
                .param("order", exceptOrderId == null ? "" : exceptOrderId)
                .query(Integer.class)
                .single();
    }

    /** Held reservations past their expiry, locked and skipped by any other instance doing the same sweep. */
    public List<Reservation> lockExpired(Instant now, int limit) {
        return jdbc.sql("SELECT " + COLUMNS + """
                 FROM promo_reservations
                WHERE status = 'held' AND expires_at < :now
                ORDER BY expires_at
                LIMIT :limit
                FOR UPDATE SKIP LOCKED
                """)
                .param("now", Timestamp.from(now))
                .param("limit", limit)
                .query(ReservationRepository::map)
                .list();
    }

    public void setStatus(UUID id, String status, String reason) {
        jdbc.sql("UPDATE promo_reservations SET status = :status, reason = :reason, updated_at = now() WHERE id = :id")
                .param("status", status)
                .param("reason", reason)
                .param("id", id)
                .update();
    }

    private static Reservation map(ResultSet rs, int n) throws SQLException {
        return new Reservation(
                rs.getObject("id", UUID.class),
                rs.getString("code"),
                rs.getString("customer_id"),
                rs.getString("order_id"),
                rs.getLong("discount_minor"),
                rs.getString("currency"),
                rs.getString("funded_by"),
                rs.getString("status"),
                rs.getString("reason"),
                rs.getTimestamp("expires_at").toInstant());
    }
}
