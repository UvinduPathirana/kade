package lk.kade.promotion.voucher;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Customers' finished orders as seen on kade.order.events: decides "first order" for codes and referrals. */
@Repository
public class CustomerHistory {

    private final JdbcClient jdbc;

    public CustomerHistory(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public boolean hasFinishedOrder(String customerId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM customer_orders WHERE customer_id = :c)")
                .param("c", customerId)
                .query(Boolean.class)
                .single();
    }

    /** Records a finished order; returns the customer's finished-order count afterwards (1 = first order). */
    public int recordFinished(String customerId, String orderId) {
        jdbc.sql("INSERT INTO customer_orders (customer_id, order_id) VALUES (:c, :o) ON CONFLICT DO NOTHING")
                .param("c", customerId)
                .param("o", orderId)
                .update();
        return jdbc.sql("SELECT count(*) FROM customer_orders WHERE customer_id = :c")
                .param("c", customerId)
                .query(Integer.class)
                .single();
    }
}
