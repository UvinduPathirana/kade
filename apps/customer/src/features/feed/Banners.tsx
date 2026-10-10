import { Button } from "@kade/ui";
import { legProgress, orderStatus } from "@/api/orderStatus";
import { useActiveOrder } from "@/api/queries";
import { OrderProgress } from "@/features/orders/OrderProgress";
import { statusCopy } from "@/features/orders/statusCopy";
import { useNow } from "@/lib/useNow";
import styles from "./Banners.module.css";

/** Shown while one of your orders is on its way. Hidden otherwise. */
export function LiveOrderBanner() {
  const { data: order } = useActiveOrder();
  const now = useNow(1000, !!order);
  if (!order) return null;
  const status = orderStatus(order, now);
  const { headline, detail } = statusCopy(order, status, now);
  const initial = order.rider?.name[0] ?? order.restaurant.name[0];

  return (
    <section className={styles.live} aria-label="Order in progress">
      <div className={styles.rider} aria-hidden="true">
        {initial}
      </div>
      <div>
        <strong className={styles.liveTitle}>{headline}</strong>
        <p className={styles.liveText}>{detail}</p>
        {status !== "scheduled" && (
          <OrderProgress
            mode={order.mode}
            status={status}
            progress={legProgress(order, now)}
            className={styles.steps}
          />
        )}
      </div>
      <Button href={`/orders/${order.id}`} className={styles.track}>
        Track order
      </Button>
    </section>
  );
}

export function PlusStrip() {
  return (
    <aside className={styles.plus} aria-label="Kadé Plus membership">
      <div>
        <p className={styles.plusName}>Kadé Plus</p>
        <p className={styles.plusText}>
          No delivery fee on orders over Rs 1,500, and 5% back on every pickup. First month free, then Rs 990
          a month.
        </p>
      </div>
      <Button href="/plus" variant="outline" className={styles.plusCta}>
        Try Plus free
      </Button>
    </aside>
  );
}
