package lk.kade.payment.payments;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import lk.kade.payment.error.OptimisticLockException;
import lk.kade.payment.money.Money;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Plain SQL for payments and refunds. Updates are optimistic: {@code WHERE id = ? AND version = ?}. */
@Repository
public class PaymentRepository {

    private static final String COLUMNS = """
            id, purpose, reference_id, reference_label, customer_id, method_kind, card_id, card_brand, card_last4,
            cash_paying_with_minor, currency, status, amount_requested_minor, amount_authorised_minor,
            amount_captured_minor, amount_refunded_minor, psp_reference, decline_code, decline_message,
            collected_by_rider_id, delivery_id, version, created_at, authorised_at, captured_at, voided_at""";

    private final JdbcClient jdbc;

    public PaymentRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** A payment and the request hash its authorise key was first used with. */
    public record Keyed(PaymentRow payment, byte[] requestHash) {}

    /**
     * Inserts a new payment holding the authorise key. Returns false if the key is already taken (a concurrent
     * duplicate blocks here until the first transaction commits, then sees the conflict).
     */
    public boolean insert(PaymentRow p, String principal, String key, byte[] requestHash) {
        return jdbc.sql("""
                INSERT INTO payments (id, purpose, reference_id, reference_label, customer_id, method_kind, card_id,
                    card_brand, card_last4, cash_paying_with_minor, currency, status, amount_requested_minor,
                    amount_authorised_minor, psp_reference, decline_code, decline_message, authorise_principal,
                    authorise_key, authorise_request_hash, created_at, authorised_at, updated_at)
                VALUES (:id, :purpose, :referenceId, :referenceLabel, :customerId, :methodKind, :cardId,
                    :cardBrand, :cardLast4, :cashPayingWith, :currency, :status, :requested,
                    :authorised, :pspReference, :declineCode, :declineMessage, :principal,
                    :key, :hash, :createdAt, :authorisedAt, :createdAt)
                ON CONFLICT (authorise_principal, authorise_key) DO NOTHING
                """)
                .param("id", p.id)
                .param("purpose", p.purpose)
                .param("referenceId", p.referenceId)
                .param("referenceLabel", p.referenceLabel)
                .param("customerId", p.customerId)
                .param("methodKind", p.methodKind)
                .param("cardId", p.cardId)
                .param("cardBrand", p.cardBrand)
                .param("cardLast4", p.cardLast4)
                .param("cashPayingWith", p.cashPayingWithMinor)
                .param("currency", p.currency)
                .param("status", p.status)
                .param("requested", p.requestedMinor)
                .param("authorised", p.authorisedMinor)
                .param("pspReference", p.pspReference)
                .param("declineCode", p.declineCode)
                .param("declineMessage", p.declineMessage)
                .param("principal", principal)
                .param("key", key)
                .param("hash", requestHash)
                .param("createdAt", Timestamp.from(p.createdAt))
                .param("authorisedAt", ts(p.authorisedAt))
                .update() == 1;
    }

    public Optional<PaymentRow> find(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM payments WHERE id = :id")
                .param("id", id).query(PaymentRepository::map).optional();
    }

    /** Same, with {@code FOR UPDATE}: serialises writers that cannot simply retry (webhooks, consumers). */
    public Optional<PaymentRow> findForUpdate(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM payments WHERE id = :id FOR UPDATE")
                .param("id", id).query(PaymentRepository::map).optional();
    }

    public Optional<Keyed> findByAuthoriseKey(String principal, String key) {
        return jdbc.sql("SELECT " + COLUMNS + ", authorise_request_hash FROM payments "
                        + "WHERE authorise_principal = :principal AND authorise_key = :key")
                .param("principal", principal).param("key", key)
                .query((rs, n) -> new Keyed(map(rs, n), rs.getBytes("authorise_request_hash")))
                .optional();
    }

    /** Payments for an order (or other reference), newest first. */
    public List<PaymentRow> findByReference(String referenceId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM payments WHERE reference_id = :r ORDER BY created_at DESC, id DESC")
                .param("r", referenceId).query(PaymentRepository::map).list();
    }

    public List<PaymentRow> list(String referenceId, String customerId, int limit, int offset) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM payments WHERE " + filter(referenceId, customerId)
                        + " ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset")
                .param("r", referenceId).param("c", customerId)
                .param("limit", limit).param("offset", offset)
                .query(PaymentRepository::map).list();
    }

    public int count(String referenceId, String customerId) {
        return jdbc.sql("SELECT count(*) FROM payments WHERE " + filter(referenceId, customerId))
                .param("r", referenceId).param("c", customerId)
                .query(Integer.class).single();
    }

    private static String filter(String referenceId, String customerId) {
        StringBuilder where = new StringBuilder("true");
        if (!referenceId.isEmpty()) where.append(" AND reference_id = :r");
        if (!customerId.isEmpty()) where.append(" AND customer_id = :c");
        return where.toString();
    }

    /** Writes every mutable column if the row is still at {@code p.version}; bumps the version in memory too. */
    public void update(PaymentRow p) {
        int rows = jdbc.sql("""
                UPDATE payments SET
                    status = :status, amount_requested_minor = :requested, amount_authorised_minor = :authorised,
                    amount_captured_minor = :captured, amount_refunded_minor = :refunded,
                    psp_reference = :pspReference, decline_code = :declineCode, decline_message = :declineMessage,
                    collected_by_rider_id = :rider, delivery_id = :delivery, authorised_at = :authorisedAt,
                    captured_at = :capturedAt, voided_at = :voidedAt, version = version + 1, updated_at = now()
                 WHERE id = :id AND version = :version
                """)
                .param("status", p.status)
                .param("requested", p.requestedMinor)
                .param("authorised", p.authorisedMinor)
                .param("captured", p.capturedMinor)
                .param("refunded", p.refundedMinor)
                .param("pspReference", p.pspReference)
                .param("declineCode", p.declineCode)
                .param("declineMessage", p.declineMessage)
                .param("rider", p.collectedByRiderId)
                .param("delivery", p.deliveryId)
                .param("authorisedAt", ts(p.authorisedAt))
                .param("capturedAt", ts(p.capturedAt))
                .param("voidedAt", ts(p.voidedAt))
                .param("id", p.id)
                .param("version", p.version)
                .update();
        if (rows != 1) {
            throw new OptimisticLockException("payments", p.id, p.version);
        }
        p.version++;
    }

    // --- refunds ---------------------------------------------------------------------------------------------

    public void insertRefund(RefundRow r) {
        jdbc.sql("""
                INSERT INTO payment_refunds (id, payment_id, amount_minor, currency, reason, order_refund_id, status,
                                             psp_reference, created_at, completed_at)
                VALUES (:id, :payment, :amount, :currency, :reason, :orderRefundId, :status, :psp, :created, :completed)
                """)
                .param("id", r.id())
                .param("payment", r.paymentId())
                .param("amount", r.amount().amountMinor())
                .param("currency", r.amount().currency())
                .param("reason", r.reason())
                .param("orderRefundId", r.orderRefundId())
                .param("status", r.status())
                .param("psp", r.pspReference())
                .param("created", Timestamp.from(r.createdAt()))
                .param("completed", ts(r.completedAt()))
                .update();
    }

    public Optional<RefundRow> findRefund(UUID id) {
        return jdbc.sql("SELECT * FROM payment_refunds WHERE id = :id").param("id", id)
                .query(PaymentRepository::mapRefund).optional();
    }

    public void completeRefund(UUID id, String status, Instant at) {
        jdbc.sql("UPDATE payment_refunds SET status = :status, completed_at = :at WHERE id = :id")
                .param("status", status).param("at", Timestamp.from(at)).param("id", id).update();
    }

    public List<RefundRow> refunds(UUID paymentId) {
        return jdbc.sql("SELECT * FROM payment_refunds WHERE payment_id = :p ORDER BY created_at, id")
                .param("p", paymentId).query(PaymentRepository::mapRefund).list();
    }

    public Map<UUID, List<RefundRow>> refunds(Collection<UUID> paymentIds) {
        if (paymentIds.isEmpty()) {
            return Map.of();
        }
        return jdbc.sql("SELECT * FROM payment_refunds WHERE payment_id IN (:ids) ORDER BY created_at, id")
                .param("ids", paymentIds).query(PaymentRepository::mapRefund).list().stream()
                .collect(Collectors.groupingBy(RefundRow::paymentId));
    }

    // --- mapping ---------------------------------------------------------------------------------------------

    private static Timestamp ts(Instant t) {
        return t == null ? null : Timestamp.from(t);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }

    private static PaymentRow map(ResultSet rs, int row) throws SQLException {
        PaymentRow p = new PaymentRow();
        p.id = rs.getObject("id", UUID.class);
        p.purpose = rs.getString("purpose");
        p.referenceId = rs.getString("reference_id");
        p.referenceLabel = rs.getString("reference_label");
        p.customerId = rs.getString("customer_id");
        p.methodKind = rs.getString("method_kind");
        p.cardId = rs.getObject("card_id", UUID.class);
        p.cardBrand = rs.getString("card_brand");
        p.cardLast4 = rs.getString("card_last4");
        long paying = rs.getLong("cash_paying_with_minor");
        p.cashPayingWithMinor = rs.wasNull() ? null : paying;
        p.currency = rs.getString("currency");
        p.status = rs.getString("status");
        p.requestedMinor = rs.getLong("amount_requested_minor");
        p.authorisedMinor = rs.getLong("amount_authorised_minor");
        p.capturedMinor = rs.getLong("amount_captured_minor");
        p.refundedMinor = rs.getLong("amount_refunded_minor");
        p.pspReference = rs.getString("psp_reference");
        p.declineCode = rs.getString("decline_code");
        p.declineMessage = rs.getString("decline_message");
        p.collectedByRiderId = rs.getString("collected_by_rider_id");
        p.deliveryId = rs.getString("delivery_id");
        p.version = rs.getLong("version");
        p.createdAt = instant(rs, "created_at");
        p.authorisedAt = instant(rs, "authorised_at");
        p.capturedAt = instant(rs, "captured_at");
        p.voidedAt = instant(rs, "voided_at");
        return p;
    }

    private static RefundRow mapRefund(ResultSet rs, int row) throws SQLException {
        return new RefundRow(
                rs.getObject("id", UUID.class),
                rs.getObject("payment_id", UUID.class),
                Money.of(rs.getLong("amount_minor"), rs.getString("currency")),
                rs.getString("reason"),
                rs.getString("order_refund_id"),
                rs.getString("status"),
                rs.getString("psp_reference"),
                instant(rs, "created_at"),
                instant(rs, "completed_at"));
    }
}
