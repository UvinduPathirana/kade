import { Container, Icon, IconButton, SearchField, SegmentedControl, Wordmark, cx } from "@kade/ui";
import { useEffect, useState } from "react";
import { modeOptions } from "@/features/cart/mode";
import { useCart, useCartTotals } from "@/features/cart/store";
import { useOpenCart } from "@/features/cart/useOpenCart";
import styles from "./SiteHeader.module.css";

export interface SiteHeaderProps {
  /** Show the Delivery/Pickup toggle (home). Hidden below 860px, where the page shows its own. */
  showModeToggle?: boolean;
  /** Render the compact search slot (home only). */
  withSearch?: boolean;
  /** Reveal the compact search (home does once the hero search scrolls away). */
  showSearch?: boolean;
  /** Checkout: just the wordmark, so nothing pulls people away from paying. */
  minimal?: boolean;
}

export function SiteHeader({
  showModeToggle = false,
  withSearch = false,
  showSearch = false,
  minimal = false,
}: SiteHeaderProps) {
  const mode = useCart((s) => s.mode);
  const setMode = useCart((s) => s.setMode);
  const openCart = useOpenCart();
  const { count } = useCartTotals();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={cx(styles.header, scrolled && styles.scrolled)}>
      <Container className={styles.row}>
        <Wordmark className={cx(styles.wordmark, minimal && styles.wordmarkAlways)} />
        {minimal ? null : (
          <>
            <button className={styles.address} type="button" aria-haspopup="dialog">
              <Icon name="pin" />
              <span>42 Galle Rd, Colombo 03</span>
              <Icon name="chevronDown" size={16} />
            </button>

            {showModeToggle && (
              <SegmentedControl
                className={styles.mode}
                label="Order type"
                options={modeOptions}
                value={mode}
                onChange={setMode}
              />
            )}

            {withSearch && (
              <div
                className={cx(styles.search, showSearch && styles.searchVisible)}
                aria-hidden={!showSearch}
              >
                <SearchField label="Search dishes, restaurants or shops" tabIndex={showSearch ? 0 : -1} />
              </div>
            )}

            <div className={styles.actions}>
              <IconButton icon="user" label="Account" href="/account" className={styles.account} />
              <button className={styles.cart} type="button" onClick={openCart}>
                <Icon name="bag" />
                <span className={styles.cartLabel}>Cart</span>
                <span className={styles.count} aria-label={`${count} ${count === 1 ? "item" : "items"}`}>
                  {count}
                </span>
              </button>
            </div>
          </>
        )}
      </Container>
    </header>
  );
}
