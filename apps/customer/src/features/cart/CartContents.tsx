import { Button, EmptyState, Link, Stepper, cx, formatRs } from "@kade/ui";
import { useEffect, useRef } from "react";
import { pickupMinutes } from "@/lib/eta";
import { imageUrl } from "@/lib/images";
import { useCart, useCartTotals, type CartLine } from "./store";
import styles from "./CartContents.module.css";

function etaText(eta: [number, number], mode: "delivery" | "pickup") {
  return mode === "delivery"
    ? `Delivery in ${eta[0]}–${eta[1]} min`
    : `Pickup in about ${pickupMinutes(eta)} min`;
}

function Line({ line }: { line: CartLine }) {
  const setQty = useCart((s) => s.setQty);
  const lastAdded = useCart((s) => s.lastAdded);
  const ref = useRef<HTMLLIElement>(null);

  // Highlight the row that was just added, so people see where their dish went
  useEffect(() => {
    if (lastAdded?.key !== line.key || Date.now() - lastAdded.at > 2000) return;
    const el = ref.current;
    if (!el) return;
    el.classList.remove(styles.flash!);
    void el.offsetWidth;
    el.classList.add(styles.flash!);
  }, [lastAdded, line.key]);

  const detail = [...line.choices, line.note].filter(Boolean).join(", ");
  return (
    <li ref={ref} className={styles.line}>
      <strong>{line.name}</strong>
      <Stepper
        value={line.qty}
        onChange={(q) => setQty(line.key, q)}
        label={`Quantity of ${line.name}`}
        itemName={line.name}
        className={styles.stepper}
      />
      <small>
        {detail && `${detail}, `}
        {formatRs(line.unitPrice * line.qty)}
      </small>
    </li>
  );
}

/** Lines + totals. Shared by the cart drawer and the restaurant page's order panel. */
export function CartContents({ showRestaurant = true }: { showRestaurant?: boolean }) {
  const { restaurant, lines, mode } = useCart();
  const t = useCartTotals();

  if (!t.count || !restaurant) {
    return (
      <EmptyState
        className={styles.empty}
        title="Your cart is empty"
        description="Add dishes from a restaurant and they'll show up here."
      />
    );
  }

  return (
    <>
      {showRestaurant && (
        <Link href={`/restaurant/${restaurant.id}`} className={styles.store}>
          <img src={imageUrl(restaurant.imageId, 120, 120)} alt="" />
          <span>
            <strong>{restaurant.name}</strong>
            <span>{etaText(restaurant.eta, mode)}</span>
          </span>
        </Link>
      )}
      <ul>
        {lines.map((l) => (
          <Line key={l.key} line={l} />
        ))}
      </ul>
      <dl className={styles.sum}>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatRs(t.subtotal)}</dd>
        </div>
        {mode === "delivery" && (
          <div>
            <dt>Delivery fee</dt>
            <dd className={cx(!t.deliveryFee && styles.free)}>
              {t.deliveryFee ? formatRs(t.deliveryFee) : "Free"}
            </dd>
          </div>
        )}
        {t.saving > 0 && (
          <div className={styles.saving}>
            <dt>Offer: {restaurant.discountPercent}% off</dt>
            <dd>− {formatRs(t.saving)}</dd>
          </div>
        )}
        <div className={styles.total}>
          <dt>Total</dt>
          <dd>{formatRs(t.total)}</dd>
        </div>
      </dl>
    </>
  );
}

/** "Go to checkout ··· Rs 3,110" — or a way back to restaurants when empty. */
export function CheckoutButton() {
  const t = useCartTotals();
  if (!t.count) {
    return (
      <Button href="/" variant="secondary" size="lg" fullWidth>
        Browse restaurants
      </Button>
    );
  }
  return (
    <Button href="/checkout" size="lg" fullWidth trailing={formatRs(t.total)}>
      Go to checkout
    </Button>
  );
}
