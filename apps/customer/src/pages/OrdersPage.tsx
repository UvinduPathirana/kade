import { Button, Chip, Container, EmptyState, Link, Tag, TextLink, formatRs } from "@kade/ui";
import { FINAL_STATUSES, legProgress, orderStatus } from "@/api/orderStatus";
import { useOrders } from "@/api/queries";
import type { Order, OrderStatus } from "@/api/types";
import { OrderProgress } from "@/features/orders/OrderProgress";
import { itemsSummary, orderDate } from "@/features/orders/format";
import { statusCopy } from "@/features/orders/statusCopy";
import { useReorder } from "@/features/orders/useReorder";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./OrdersPage.module.css";

/** On its way: the page's turmeric surface, in the tracking page's voice. */
function ActiveOrder({ order, now }: { order: Order; now: number }) {
  const status = orderStatus(order, now);
  const { headline, detail } = statusCopy(order, status, now);
  return (
    <article className={styles.active} aria-labelledby={`active-${order.id}`}>
      <p className={styles.activeFrom}>
        Order {order.id} from {order.restaurant.name}
      </p>
      <h2 id={`active-${order.id}`} className={styles.activeTitle}>
        {headline}
      </h2>
      <p className={styles.activeDetail}>{detail}</p>
      {status !== "scheduled" && (
        <OrderProgress
          mode={order.mode}
          status={status}
          progress={legProgress(order, now)}
          className={styles.steps}
        />
      )}
      <Button variant="ink" href={`/orders/${order.id}`} className={styles.track}>
        Track order
      </Button>
    </article>
  );
}

const statusTag = (order: Order, status: OrderStatus) => {
  if (order.issue?.resolution === "credit" && order.issue.amount)
    return <Tag tone="positive">{formatRs(order.issue.amount)} back as credit</Tag>;
  if (order.issue?.resolution === "card") return <Tag tone="positive">Refund on its way</Tag>;
  if (order.issue) return <Tag tone="warning">Being looked into</Tag>;
  if (status === "cancelled") return <Tag tone="neutral">Cancelled</Tag>;
  return <Tag tone="positive">{status === "collected" ? "Collected" : "Delivered"}</Tag>;
};

function PastOrder({ order, onReorder }: { order: Order; onReorder: () => void }) {
  const status = orderStatus(order);
  const cancelled = status === "cancelled";
  return (
    <li className={styles.past}>
      <img
        className={styles.thumb}
        src={imageUrl(order.restaurant.imageId, 160, 160)}
        alt=""
        loading="lazy"
      />
      <div className={styles.pastText}>
        <h3>
          <Link href={`/orders/${order.id}`}>{order.restaurant.name}</Link>
        </h3>
        <p className={styles.meta}>
          {orderDate(order.placedAt)}
          {order.mode === "pickup" ? ", pickup" : ""}
        </p>
        <p className={styles.items}>{itemsSummary(order)}</p>
        {statusTag(order, status)}
      </div>
      <div className={styles.side}>
        <strong className={styles.total}>{cancelled ? "Not charged" : formatRs(order.totals.total)}</strong>
        <div className={styles.actions}>
          <Button size="sm" icon="bag" onClick={onReorder}>
            Order again
          </Button>
          {!cancelled && <TextLink href={`/orders/${order.id}`}>Receipt</TextLink>}
          {!cancelled && !order.issue && <TextLink href={`/orders/${order.id}/help`}>Get help</TextLink>}
        </div>
      </div>
    </li>
  );
}

export function OrdersPage() {
  useDocumentTitle("Orders");
  const { data: orders, isError, refetch } = useOrders();
  const { reorder, dialog } = useReorder();
  const live = (orders ?? []).filter((o) => !FINAL_STATUSES.includes(orderStatus(o)));
  const past = (orders ?? []).filter((o) => FINAL_STATUSES.includes(orderStatus(o)));
  const now = useNow(1000, live.length > 0);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <h1 className={styles.title}>Orders</h1>

          {isError ? (
            <EmptyState
              title="Your orders didn't load"
              description="Check your connection, then try again."
              action={<Chip onClick={() => void refetch()}>Try again</Chip>}
            />
          ) : !orders ? null : orders.length === 0 ? (
            <EmptyState
              title="No orders yet"
              description="When you order, it shows up here with its receipt, so you can order the same again in two taps."
              action={<Button href="/">Find something to eat</Button>}
            />
          ) : (
            <>
              {live.length > 0 && (
                <section className={styles.liveList} aria-label="On its way">
                  {live.map((o) => (
                    <ActiveOrder key={o.id} order={o} now={now} />
                  ))}
                </section>
              )}
              <section aria-labelledby="past-title" className={styles.pastSection}>
                <h2 id="past-title" className={styles.heading}>
                  Past orders
                </h2>
                {past.length ? (
                  <ul className={styles.pastList}>
                    {past.map((o) => (
                      <PastOrder key={o.id} order={o} onReorder={() => reorder(o)} />
                    ))}
                  </ul>
                ) : (
                  <p className={styles.none}>Orders you've received show up here once they're delivered.</p>
                )}
              </section>
            </>
          )}
        </Container>
      </main>
      {dialog}
      <SiteFooter />
      <TabBar />
    </>
  );
}
