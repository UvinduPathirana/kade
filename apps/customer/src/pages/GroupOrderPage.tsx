import { Button, Container, EmptyState, Icon, Tag, formatRs, plural, useToast } from "@kade/ui";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { joinedMembers } from "@/api/group";
import { clockTime } from "@/api/orderStatus";
import { useGroup, useRestaurant } from "@/api/queries";
import type { OrderLine } from "@/api/types";
import { cartSnapshot, useCart } from "@/features/cart/store";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./GroupOrderPage.module.css";

const sum = (lines: OrderLine[]) => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

function Person({
  name,
  host,
  lines,
  limit,
  children,
}: {
  name: string;
  host?: boolean;
  lines: OrderLine[];
  limit?: number;
  children?: ReactNode;
}) {
  const total = sum(lines);
  const over = limit && total > limit ? total - limit : 0;
  return (
    <li className={styles.person}>
      <div className={styles.personHead}>
        <span className={styles.avatar} aria-hidden="true">
          {name[0]}
        </span>
        <h3>
          {name}
          {host && <Tag tone="neutral">Host</Tag>}
        </h3>
        <strong className={styles.personTotal}>{lines.length ? formatRs(total) : ""}</strong>
      </div>
      {lines.length > 0 && (
        <ul className={styles.lines}>
          {lines.map((l) => (
            <li key={l.key}>
              <span>
                {l.qty}× {l.name}
              </span>
              <span>{formatRs(l.unitPrice * l.qty)}</span>
            </li>
          ))}
        </ul>
      )}
      {over > 0 && (
        <p className={styles.over}>
          {formatRs(over)} over the {formatRs(limit!)} limit
        </p>
      )}
      {children}
    </li>
  );
}

export function GroupOrderPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: group, error } = useGroup(id);
  const { data: restaurant } = useRestaurant(group?.restaurantId ?? 0);
  const cartRestaurantId = useCart((s) => s.restaurant?.id);
  const cartLines = useCart((s) => s.lines);
  const cartGroupId = useCart((s) => s.groupId);
  const replaceWith = useCart((s) => s.replaceWith);
  const open = !!group && !group.orderId;
  const now = useNow(1000, open);
  useDocumentTitle(group ? `Group order from ${group.restaurantName}` : "Group order");

  if (error)
    return (
      <>
        <SiteHeader />
        <Container className={styles.page}>
          <EmptyState
            title="This group order has ended"
            description="The link may be old, or the host has already placed the order. Start your own from any restaurant page."
            action={<Button href="/">Find a restaurant</Button>}
          />
        </Container>
      </>
    );
  if (!group) return <SiteHeader />;

  const joined = joinedMembers(group, now);
  const closed = now >= group.closesAt;
  const minutesLeft = Math.max(0, Math.ceil((group.closesAt - now) / 60_000));
  // The host's own dishes are whatever is in their cart from this restaurant (minus anything already merged in)
  const hostLines =
    cartRestaurantId === group.restaurantId
      ? cartGroupId === group.id
        ? cartLines.filter((l) => !l.note.startsWith("For "))
        : cartLines
      : [];
  const everyone = [...hostLines, ...joined.flatMap((m) => m.lines)];
  const link = `${location.origin}/group/${group.id}`;
  const latest = joined[joined.length - 1];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", description: "Paste it into your group chat." });
    } catch {
      toast({ title: "Copy the link from the box", description: "Your browser didn't allow copying." });
    }
  };

  const share = async () => {
    try {
      await navigator.share({
        title: `Order from ${group.restaurantName}`,
        text: `Add your dishes before ${clockTime(group.closesAt)}`,
        url: link,
      });
    } catch {
      // Share sheet dismissed
    }
  };

  const placeOrder = () => {
    if (!restaurant) return;
    replaceWith(cartSnapshot(restaurant), everyone, { groupId: group.id });
    navigate("/checkout");
  };

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <div className={styles.layout}>
            <div>
              <p className={styles.kicker}>Group order hosted by {group.hostName}</p>
              <h1 className={styles.title}>{group.restaurantName}</h1>
              <p className={styles.status} aria-live="polite">
                {group.orderId
                  ? "The order has been placed."
                  : closed
                    ? `Closed at ${clockTime(group.closesAt)}. Nobody else can add dishes, so place the order now.`
                    : `${plural(joined.length + 1, "person", "people")} in so far. Closes at ${clockTime(group.closesAt)}, in ${plural(minutesLeft, "minute")}.`}
                {group.limit ? ` Limit ${formatRs(group.limit)} each.` : ""}
              </p>
              <p className="kd-visually-hidden" aria-live="polite">
                {latest
                  ? `${latest.name} joined and added ${plural(
                      latest.lines.reduce((n, l) => n + l.qty, 0),
                      "dish",
                      "dishes",
                    )}`
                  : ""}
              </p>

              <ul className={styles.people}>
                <Person name={`${group.hostName} (you)`} host lines={hostLines} limit={group.limit}>
                  {!hostLines.length && !group.orderId && (
                    <div className={styles.addOwn}>
                      <p>
                        {cartRestaurantId && cartRestaurantId !== group.restaurantId
                          ? "Your cart has dishes from another restaurant. Add yours from this one to join in."
                          : "You haven't added anything yet."}
                      </p>
                      <Button href={`/restaurant/${group.restaurantId}`} size="sm" icon="plus">
                        Add your dishes
                      </Button>
                    </div>
                  )}
                </Person>
                {joined.map((m) => (
                  <Person key={m.name} name={m.name} lines={m.lines} limit={group.limit} />
                ))}
                {!closed && !group.orderId && joined.length < group.members.length && (
                  <li className={styles.waiting}>
                    <Icon name="clock" size={18} />
                    Waiting for others to open the link
                  </li>
                )}
              </ul>
            </div>

            <aside className={styles.aside}>
              {group.orderId ? (
                <section className={styles.share} aria-labelledby="placed-title">
                  <h2 id="placed-title" className={styles.shareTitle}>
                    Order placed for {plural(joined.length + 1, "person", "people")}.
                  </h2>
                  <Button variant="ink" href={`/orders/${group.orderId}`}>
                    Track order
                  </Button>
                </section>
              ) : (
                <section className={styles.share} aria-labelledby="share-title">
                  <h2 id="share-title" className={styles.shareTitle}>
                    Send this link to everyone ordering.
                  </h2>
                  <label className="kd-visually-hidden" htmlFor="group-link">
                    Group order link
                  </label>
                  <input
                    id="group-link"
                    className={styles.link}
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className={styles.shareActions}>
                    <Button variant="ink" icon="share" onClick={() => void copy()}>
                      Copy link
                    </Button>
                    {"share" in navigator && (
                      <Button variant="outline" onClick={() => void share()} className={styles.onTurmeric}>
                        Share
                      </Button>
                    )}
                  </div>
                </section>
              )}

              {!group.orderId && (
                <div className={styles.total}>
                  <p>
                    <span>Food for {plural(joined.length + 1, "person", "people")}</span>
                    <strong>{formatRs(sum(everyone))}</strong>
                  </p>
                  <p className={styles.muted}>
                    Delivery fee, tip and any offer are added at checkout. You pay for the whole order.
                  </p>
                  <Button size="lg" fullWidth disabled={!everyone.length || !restaurant} onClick={placeOrder}>
                    Review and place order
                  </Button>
                </div>
              )}
            </aside>
          </div>
        </Container>
      </main>
    </>
  );
}
