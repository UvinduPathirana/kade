package lk.kade.promotion.voucher;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import lk.kade.promotion.error.OptimisticLockException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class VoucherRepository {

    private static final String COLUMNS = """
            code, label, description, type, amount_minor, percent, max_discount_minor, min_order_minor, currency,
            restaurant_ids, new_customers_only, starts_on, ends_on, uses, held_uses, use_limit, per_customer_limit,
            budget_minor, spent_minor, reserved_minor, status, status_reason, funded_by, created_at, version
            """;

    private final JdbcClient jdbc;

    public VoucherRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<VoucherRow> find(String code) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM vouchers WHERE code = :code")
                .param("code", code)
                .query(VoucherRepository::map)
                .optional();
    }

    /** Every voucher, newest status first: active, scheduled, paused, ended; then newest created. */
    public List<VoucherRow> list(String statusOrNull, int limit, int offset) {
        return jdbc.sql("SELECT " + COLUMNS + """
                 FROM vouchers
                WHERE (CAST(:status AS text) IS NULL OR status = :status)
                ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
                         created_at DESC, code
                LIMIT :limit OFFSET :offset
                """)
                .param("status", statusOrNull)
                .param("limit", limit)
                .param("offset", offset)
                .query(VoucherRepository::map)
                .list();
    }

    public int count(String statusOrNull) {
        return jdbc.sql("SELECT count(*) FROM vouchers WHERE (CAST(:status AS text) IS NULL OR status = :status)")
                .param("status", statusOrNull)
                .query(Integer.class)
                .single();
    }

    public List<VoucherRow> listByStatus(String status) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM vouchers WHERE status = :status ORDER BY created_at")
                .param("status", status)
                .query(VoucherRepository::map)
                .list();
    }

    /** Inserts a new voucher; false when the code is already taken. */
    public boolean insert(VoucherRow v) {
        return jdbc.sql("""
                INSERT INTO vouchers (code, label, description, type, amount_minor, percent, max_discount_minor,
                    min_order_minor, currency, restaurant_ids, new_customers_only, starts_on, ends_on, uses, held_uses,
                    use_limit, per_customer_limit, budget_minor, spent_minor, reserved_minor, status, status_reason,
                    funded_by, created_at)
                VALUES (:code, :label, :description, :type, :amount, :percent, :maxDiscount, :minOrder, :currency,
                    CAST(:restaurantIds AS text[]), :newOnly, :startsOn, :endsOn, :uses, :heldUses, :useLimit,
                    :perCustomer, :budget, :spent, :reserved, :status, :reason, :fundedBy, :createdAt)
                ON CONFLICT (code) DO NOTHING
                """)
                .param("code", v.code())
                .param("label", v.label())
                .param("description", v.description())
                .param("type", v.type().db)
                .param("amount", v.amountMinor())
                .param("percent", v.percent())
                .param("maxDiscount", v.maxDiscountMinor())
                .param("minOrder", v.minOrderMinor())
                .param("currency", v.currency())
                .param("restaurantIds", pgArray(v.restaurantIds()))
                .param("newOnly", v.newCustomersOnly())
                .param("startsOn", v.startsOn())
                .param("endsOn", v.endsOn())
                .param("uses", v.uses())
                .param("heldUses", v.heldUses())
                .param("useLimit", v.useLimit())
                .param("perCustomer", v.perCustomerLimit())
                .param("budget", v.budgetMinor())
                .param("spent", v.spentMinor())
                .param("reserved", v.reservedMinor())
                .param("status", v.status())
                .param("reason", v.statusReason())
                .param("fundedBy", v.fundedBy())
                .param("createdAt", java.sql.Timestamp.from(v.createdAt()))
                .update() == 1;
    }

    /**
     * Writes counters and status if the row is still at {@code next.version()} (optimistic locking): the budget and
     * use-limit checks were made in Java against that version, so a concurrent reservation forces a re-read.
     */
    public void update(VoucherRow next) {
        int rows = jdbc.sql("""
                UPDATE vouchers
                   SET uses = :uses, held_uses = :heldUses, spent_minor = :spent, reserved_minor = :reserved,
                       status = :status, status_reason = :reason, version = version + 1
                 WHERE code = :code AND version = :version
                """)
                .param("uses", next.uses())
                .param("heldUses", next.heldUses())
                .param("spent", next.spentMinor())
                .param("reserved", next.reservedMinor())
                .param("status", next.status())
                .param("reason", next.statusReason())
                .param("code", next.code())
                .param("version", next.version())
                .update();
        if (rows != 1) {
            throw new OptimisticLockException("vouchers", next.code(), next.version());
        }
    }

    /** Postgres array literal for a text[] parameter ({@code CAST(:x AS text[])}). */
    static String pgArray(List<String> values) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append('"').append(values.get(i).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        }
        return sb.append('}').toString();
    }

    static List<String> strings(Array array) throws SQLException {
        if (array == null) {
            return List.of();
        }
        return Arrays.stream((Object[]) array.getArray()).map(String::valueOf).toList();
    }

    private static VoucherRow map(ResultSet rs, int n) throws SQLException {
        return new VoucherRow(
                rs.getString("code"),
                rs.getString("label"),
                rs.getString("description"),
                VoucherRow.Kind.fromDb(rs.getString("type")),
                rs.getLong("amount_minor"),
                rs.getInt("percent"),
                rs.getLong("max_discount_minor"),
                rs.getLong("min_order_minor"),
                rs.getString("currency"),
                strings(rs.getArray("restaurant_ids")),
                rs.getBoolean("new_customers_only"),
                rs.getDate("starts_on").toLocalDate(),
                rs.getDate("ends_on").toLocalDate(),
                rs.getInt("uses"),
                rs.getInt("held_uses"),
                rs.getInt("use_limit"),
                rs.getInt("per_customer_limit"),
                rs.getLong("budget_minor"),
                rs.getLong("spent_minor"),
                rs.getLong("reserved_minor"),
                rs.getString("status"),
                rs.getString("status_reason"),
                rs.getString("funded_by"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getLong("version"));
    }
}
