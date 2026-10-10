import { Button, Panel } from "@kade/ui";
import { useNavigate } from "react-router";
import { clockTime } from "@/api/orderStatus";
import type { Order } from "@/api/types";
import { useCart } from "@/features/cart/store";
import { OrderSummary } from "@/features/checkout/OrderSummary";
import styles from "./Receipt.module.css";

const paymentText = (o: Order) =>
  o.payment.type === "card"
    ? `${o.payment.brand} ending ${o.payment.last4}`
    : o.mode === "delivery"
      ? "Cash on delivery"
      : "Paid at the counter";

/** Itemised receipt with "Order again". */
export function Receipt({ order }: { order: Order }) {
  const navigate = useNavigate();
  const replaceWith = useCart((s) => s.replaceWith);
  const placed = new Date(order.placedAt);

  const orderAgain = () => {
    const { area: _area, ...restaurant } = order.restaurant;
    void _area;
    replaceWith(restaurant, order.lines);
    navigate("/cart");
  };

  return (
    <Panel title="Receipt" titleId="receipt-title" className={styles.receipt}>
      <dl className={styles.meta}>
        <div>
          <dt>Order</dt>
          <dd>{order.id}</dd>
        </div>
        <div>
          <dt>Placed</dt>
          <dd>
            {placed.toLocaleDateString("en-LK", { day: "numeric", month: "short" })},{" "}
            {clockTime(order.placedAt)}
          </dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>{order.restaurant.name}</dd>
        </div>
        {order.address && (
          <div>
            <dt>To</dt>
            <dd>{order.address.line}</dd>
          </div>
        )}
        <div>
          <dt>Payment</dt>
          <dd>{paymentText(order)}</dd>
        </div>
      </dl>
      <OrderSummary
        lines={order.lines}
        totals={order.totals}
        discountPercent={order.restaurant.discountPercent}
        promoCode={order.promoCode}
        delivery={order.mode === "delivery"}
      />
      <div className={styles.actions}>
        <Button onClick={orderAgain} icon="bag">
          Order again
        </Button>
        <Button variant="secondary" icon="printer" onClick={() => window.print()}>
          Print receipt
        </Button>
        <Button variant="outline" href="/help">
          Get help with this order
        </Button>
      </div>
    </Panel>
  );
}
