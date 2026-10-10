import { Container, Icon, IconButton, SearchField, SegmentedControl, Wordmark, cx } from "@kade/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useSession } from "@/features/account/session";
import { useAddress } from "@/features/address/store";
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
  const address = useAddress((s) => s.current);
  const openPicker = useAddress((s) => s.setPickerOpen);
  const signedIn = useSession((s) => !!s.user);
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [query, setQuery] = useState("");

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
            <button
              className={styles.address}
              type="button"
              aria-haspopup="dialog"
              aria-label={`${address.line}, delivering to ${address.label}. Change address`}
              onClick={() => openPicker(true)}
            >
              <Icon name="pin" />
              <span>{address.line}</span>
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
              <form
                role="search"
                className={cx(styles.search, showSearch && styles.searchVisible)}
                aria-hidden={!showSearch}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                }}
              >
                <SearchField
                  label="Search dishes, restaurants or shops"
                  tabIndex={showSearch ? 0 : -1}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </form>
            )}

            <div className={styles.actions}>
              {!withSearch && <IconButton icon="search" label="Search" href="/search" />}
              <IconButton
                icon="user"
                label={signedIn ? "Account" : "Sign in"}
                href={signedIn ? "/account" : "/signin"}
                className={styles.account}
              />
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
