import { Icon } from "@kade/ui";
import { useOnline } from "@/lib/useOnline";
import styles from "./OfflineBanner.module.css";

/** Pinned to the bottom of every page while the connection is down. */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div className={styles.slot} role="status" aria-live="polite">
      {!online && (
        <div className={styles.banner}>
          <Icon name="alert" />
          <p>
            <strong>You're offline.</strong> Your cart is saved. Orders, tracking and payments pick up again
            as soon as you're back online.
          </p>
        </div>
      )}
    </div>
  );
}
