import { Button } from "@kade/ui";
import styles from "./Banners.module.css";

const steps = ["Confirmed", "Cooked", "On the way", "Delivered"];

/** Shown while an order is in progress. Mock: Nimal is on the way. Live data comes from the order service. */
export function LiveOrderBanner({ current = 2 }: { current?: number }) {
  return (
    <section className={styles.live} aria-label="Order in progress">
      <div className={styles.rider} aria-hidden="true">
        N
      </div>
      <div>
        <strong className={styles.liveTitle}>Nimal is on the way with your kottu</strong>
        <p className={styles.liveText}>From Galle Road Kottu House. Arriving around 7:42 pm.</p>
        <ol className={styles.steps}>
          {steps.map((s, i) => (
            <li
              key={s}
              className={i < current ? styles.done : i === current ? styles.now : undefined}
              aria-current={i === current ? "step" : undefined}
            >
              {s}
            </li>
          ))}
        </ol>
      </div>
      <Button href="/orders/live" className={styles.track}>
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
