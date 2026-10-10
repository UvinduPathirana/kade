import { Button, ConfirmDialog, Container, EmptyState, cx } from "@kade/ui";
import { useState } from "react";
import { useParams } from "react-router";
import { OrderError } from "@/api/orders";
import { FINAL_STATUSES, TIMELINE, clockTime, legProgress, orderStatus, startOf } from "@/api/orderStatus";
import { useCancelOrder, useMarkCollected, useOrder } from "@/api/queries";
import type { Order, OrderStatus } from "@/api/types";
import { DeliveryMap } from "@/features/orders/DeliveryMap";
import { OrderProgress } from "@/features/orders/OrderProgress";
import { RateOrder } from "@/features/orders/RateOrder";
import { Receipt } from "@/features/orders/Receipt";
import { RiderCard } from "@/features/orders/RiderCard";
import { statusCopy } from "@/features/orders/statusCopy";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./OrderPage.module.css";

/** The page's one turmeric surface: what's happening, in a sentence. */
function StatusBand({ order, status, now }: { order: Order; status: OrderStatus; now: number }) {
  const { headline, detail } = statusCopy(order, status, now);
  return (
    <section className={cx(styles.band, status === "cancelled" && styles.bandQuiet)} aria-live="polite">
      <p className={styles.orderId}>
        Order {order.id} from {order.restaurant.name}
      </p>
      <h1 className={styles.headline}>{headline}</h1>
      <p className={styles.detail}>{detail}</p>
    </section>
  );
}

function Tracking({ order, status, now }: { order: Order; status: OrderStatus; now: number }) {
  const cancel = useCancelOrder();
  const collected = useMarkCollected();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canCancel = status === "placed" || status === "scheduled";
  const progress = legProgress(order, now);
  const riderAssigned = !["placed", "scheduled"].includes(status);

  return (
    <div className={styles.layout}>
      <div className={styles.side}>
        <StatusBand order={order} status={status} now={now} />
        {status !== "scheduled" && status !== "cancelled" && (
          <OrderProgress mode={order.mode} status={status} progress={progress} className={styles.progress} />
        )}

        {order.mode === "delivery" && status !== "cancelled" && (
          <RiderCard order={order} assigned={riderAssigned} />
        )}

        {status === "ready" && (
          <Button
            size="lg"
            fullWidth
            onClick={() => collected.mutate(order.id)}
            disabled={collected.isPending}
          >
            I've collected my order
          </Button>
        )}

        {order.riderNote && order.mode === "delivery" && status !== "cancelled" && (
          <p className={styles.note}>
            <strong>Your note for the rider:</strong> {order.riderNote}
          </p>
        )}

        {cancel.error && (
          <p className={styles.error} role="alert">
            {cancel.error instanceof OrderError ? cancel.error.message : "That didn't work. Try again."}
          </p>
        )}

        <div className={styles.actions}>
          {canCancel && (
            <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={cancel.isPending}>
              Cancel order
            </Button>
          )}
          {status === "cancelled" ? (
            <Button href="/">Find something else</Button>
          ) : (
            <Button variant="outline" href={`/support?order=${order.id}`}>
              Chat with support
            </Button>
          )}
        </div>

        <details className={styles.details}>
          <summary>Order details, {order.lines.reduce((n, l) => n + l.qty, 0)} items</summary>
          <Receipt order={order} />
        </details>
      </div>

      <div className={styles.mapWrap}>
        <DeliveryMap mode={order.mode} status={status} progress={progress} riderName={order.rider?.name} />
        {order.scheduledFor && status === "scheduled" && (
          <p className={styles.mapNote}>Scheduled for {clockTime(order.scheduledFor)}</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this order?"
        description={`${order.restaurant.name} hasn't started on it yet. ${
          order.payment.type === "card" ? "You won't be charged." : "There's nothing to pay."
        }`}
        cancelLabel="Keep order"
        confirmLabel="Cancel order"
        onConfirm={() => cancel.mutate(order.id)}
      />
    </div>
  );
}

function Delivered({ order, status }: { order: Order; status: OrderStatus }) {
  const firstDish = order.lines[0]?.name.toLowerCase() ?? "food";
  const when = clockTime(order.collectedAt ?? startOf(order) + TIMELINE.delivered * 1000);
  return (
    <>
      <section className={styles.band} aria-labelledby="done-title">
        <p className={styles.orderId}>
          Order {order.id} from {order.restaurant.name}
        </p>
        <h1 id="done-title" className={styles.headline}>
          {status === "collected" ? "Collected" : "Delivered"} at {when}. Enjoy your {firstDish}.
        </h1>
      </section>
      <div className={styles.doneLayout}>
        <RateOrder order={order} />
        <Receipt order={order} />
      </div>
    </>
  );
}

export function OrderPage() {
  const { id = "" } = useParams();
  const { data: order, error } = useOrder(id);
  const live = !!order && !FINAL_STATUSES.includes(orderStatus(order));
  const now = useNow(1000, live);
  const status = order ? orderStatus(order, now) : undefined;
  useDocumentTitle(order ? `Order ${order.id}` : "Order");

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          {order && status ? (
            status === "delivered" || status === "collected" ? (
              <Delivered order={order} status={status} />
            ) : (
              <Tracking order={order} status={status} now={now} />
            )
          ) : error ? (
            <EmptyState
              className={styles.missing}
              title="We can't find this order"
              description="It may have been placed on another device, or the link is mistyped."
              action={<Button href="/orders">See your orders</Button>}
            />
          ) : null}
        </Container>
      </main>
    </>
  );
}
