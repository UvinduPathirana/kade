import { Icon } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./Rating.module.css";

export interface RatingProps {
  value: number;
  /** e.g. "3k+" — included in the accessible label. */
  count?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Compact score pill: ★ 4.8 */
export function Rating({ value, count, size = "sm", className }: RatingProps) {
  return (
    <span
      className={cx(styles.rating, styles[size], className)}
      aria-label={`Rated ${value}${count ? ` from ${count} ratings` : ""}`}
    >
      <Icon name="star" size={size === "md" ? 14 : 12} className={styles.star} />
      {value.toFixed(1)}
    </span>
  );
}

/** Row of five stars for a single review. */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx(styles.stars, className)} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={14} className={n <= value ? styles.star : styles.starOff} />
      ))}
    </span>
  );
}
