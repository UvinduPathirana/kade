import { Button, EmptyState, formatRs } from "@kade/ui";
import { useEffect } from "react";
import type { Restaurant } from "@/api/types";
import { CartContents, CheckoutButton } from "@/features/cart/CartContents";
import { useCart, useCartTotals } from "@/features/cart/store";
import styles from "./OrderPanel.module.css";

/** Sticky "Your order" panel beside the menu on wide screens. */
export function OrderPanel({ restaurant }: { restaurant: Restaurant }) {
  const cartRestaurant = useCart((s) => s.restaurant);
  const openCart = useCart((s) => s.setDrawerOpen);
  const { count } = useCartTotals();
  const mine = count > 0 && cartRestaurant?.id === restaurant.id;

  return (
    <aside className={styles.panel} aria-labelledby="order-title">
      <h2 id="order-title" className={styles.title}>
        Your order
      </h2>
      <div className={styles.body}>
        {mine ? (
          <CartContents showRestaurant={false} />
        ) : count > 0 ? (
          <p className={styles.other}>
            <strong>Your cart has dishes from {cartRestaurant?.name}</strong>
            Adding a dish here starts a new order.
          </p>
        ) : (
          <EmptyState
            className={styles.empty}
            title="Nothing added yet"
            description={`Choose a dish to start your order.${
              restaurant.discountPercent
                ? ` ${restaurant.discountPercent}% off is taken off at checkout.`
                : ""
            }`}
          />
        )}
      </div>
      {mine ? (
        <div className={styles.foot}>
          <CheckoutButton />
        </div>
      ) : count > 0 ? (
        <div className={styles.foot}>
          <Button variant="secondary" size="lg" fullWidth onClick={() => openCart(true)}>
            View cart
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

/** Bottom "View order" bar on narrow screens, shown once this restaurant's dishes are in the cart. */
export function OrderBar({ restaurant }: { restaurant: Restaurant }) {
  const cartRestaurant = useCart((s) => s.restaurant);
  const openCart = useCart((s) => s.setDrawerOpen);
  const { count, total } = useCartTotals();
  const visible = count > 0 && cartRestaurant?.id === restaurant.id;

  useEffect(() => {
    document.body.classList.toggle(styles.hasBar!, visible);
    return () => document.body.classList.remove(styles.hasBar!);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className={styles.bar}>
      <button type="button" onClick={() => openCart(true)}>
        <span className={styles.barCount}>{count}</span>
        <span className={styles.barLabel}>View order</span>
        <span>{formatRs(total)}</span>
      </button>
    </div>
  );
}
