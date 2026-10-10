import { Button, Container, Icon, Link, SectionHeader, formatRs } from "@kade/ui";
import type { ReactNode } from "react";
import { DELIVERY_ZONE } from "@/api/addresses";
import { FINAL_STATUSES, orderStatus } from "@/api/orderStatus";
import { useOrders } from "@/api/queries";
import type { Order } from "@/api/types";
import { itemsSummary, orderDate } from "@/features/orders/format";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useHashScroll } from "@/lib/useHashScroll";
import styles from "./HelpPage.module.css";

const topics: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "refunds",
    title: "Refunds and Kadé credit",
    body: (
      <>
        Credit lands in your account straight away and comes off your next order at checkout. Card refunds
        take 5 to 7 working days to show, depending on your bank. Cash orders are refunded as credit.
      </>
    ),
  },
  {
    id: "payments",
    title: "A payment didn't go through",
    body: (
      <>
        If your bank declines a card, nothing is taken. Choose another card or cash on delivery and place the
        order again. If you see a charge for an order that failed, it drops off within 3 working days.
      </>
    ),
  },
  {
    id: "areas",
    title: "Where Kadé delivers",
    body: (
      <>
        {DELIVERY_ZONE}. Search for your address from the top of any page; if it's outside, you can save it
        and we'll tell you when we start delivering there. <Link href="/welcome#areas">See every area</Link>.
      </>
    ),
  },
  {
    id: "allergies",
    title: "Allergies and special requests",
    body: (
      <>
        Add a note to the dish when you choose its options. Kitchens read every note, but they can't promise a
        dish is free of traces of nuts, gluten or shellfish. If it matters, call the restaurant from the order
        page before it's cooked.
      </>
    ),
  },
  {
    id: "account",
    title: "Signing in and your account",
    body: (
      <>
        Sign in with your mobile number and a 6-digit code, or with Google or Apple. Change your name, saved
        addresses, cards and notifications from <Link href="/account">Account</Link>.
      </>
    ),
  },
  {
    id: "plus",
    title: "Kadé Plus",
    body: (
      <>
        No delivery fee on orders of Rs 1,500 or more, and 5% back on pickups as credit. Cancel any time; you
        keep the benefits until the end of the month you've paid for.{" "}
        <Link href="/plus">About Kadé Plus</Link>.
      </>
    ),
  },
  {
    id: "privacy",
    title: "Privacy and terms",
    body: (
      <>
        Kadé shares your name, address and a masked phone number with the restaurant and rider for each order,
        and nothing else. We never sell your data. Placing an order means you agree to pay for it once the
        kitchen accepts; you can cancel free of charge until then.
      </>
    ),
  },
];

/** The most recent order gets the page's turmeric card: it's what most people are here about. */
function RecentOrder({ order }: { order: Order }) {
  const live = !FINAL_STATUSES.includes(orderStatus(order));
  return (
    <section className={styles.recent} aria-labelledby="recent-title">
      <img src={imageUrl(order.restaurant.imageId, 200, 200)} alt="" />
      <div>
        <h2 id="recent-title" className={styles.recentTitle}>
          {live
            ? `Your ${order.restaurant.name} order is on its way`
            : `Something wrong with your ${order.restaurant.name} order?`}
        </h2>
        <p>
          {orderDate(order.placedAt)}. {itemsSummary(order)}.
        </p>
        <div className={styles.recentActions}>
          {live ? (
            <Button variant="ink" href={`/orders/${order.id}`}>
              Track order
            </Button>
          ) : order.issue ? (
            <Button variant="ink" href={`/orders/${order.id}/help`}>
              See what happens next
            </Button>
          ) : (
            <Button variant="ink" href={`/orders/${order.id}/help`}>
              Get help with this order
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export function HelpPage() {
  useDocumentTitle("Help");
  const { data: orders } = useOrders();
  useHashScroll(!!orders);
  const usable = (orders ?? []).filter((o) => orderStatus(o) !== "cancelled");
  const [latest, ...others] = usable;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <h1 className={styles.title}>Help</h1>

          {latest && <RecentOrder order={latest} />}

          {others.length > 0 && (
            <section className={styles.section} aria-labelledby="others-title">
              <SectionHeader id="others-title" title="Another order" />
              <ul className={styles.orders}>
                {others.slice(0, 4).map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}/help`} className={styles.orderRow}>
                      <span>
                        <strong>{o.restaurant.name}</strong>
                        <span>
                          {orderDate(o.placedAt)}, {formatRs(o.totals.total)}
                        </span>
                      </span>
                      <Icon name="chevronRight" size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={styles.section} aria-labelledby="topics-title">
            <SectionHeader id="topics-title" title="Common questions" />
            <div className={styles.topics}>
              {topics.map((t) => (
                <details key={t.id} id={t.id} className={styles.topic}>
                  <summary>
                    {t.title}
                    <Icon name="chevronDown" size={18} />
                  </summary>
                  <p>{t.body}</p>
                </details>
              ))}
            </div>
          </section>

          <section className={styles.chat} aria-labelledby="chat-title">
            <div>
              <h2 id="chat-title">Still stuck?</h2>
              <p>Chat with someone at Kadé. They usually answer within 2 minutes, 7 am to midnight.</p>
            </div>
            <Button href="/support" icon="chat">
              Chat with support
            </Button>
          </section>
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
