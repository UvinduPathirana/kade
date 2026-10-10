import { formatRs } from "@kade/ui";
import type { OrderLine, OrderTotals } from "@/api/types";
import styles from "./OrderSummary.module.css";

export interface OrderSummaryProps {
  lines: OrderLine[];
  totals: OrderTotals;
  discountPercent?: number;
  promoCode?: string;
  /** Show the delivery fee row (hidden for pickup). */
  delivery: boolean;
}

/** Itemised lines + totals. Used by checkout and the receipt. */
export function OrderSummary({ lines, totals: t, discountPercent, promoCode, delivery }: OrderSummaryProps) {
  return (
    <>
      <ul className={styles.lines}>
        {lines.map((l) => (
          <li key={l.key}>
            <span className={styles.qty}>{l.qty}×</span>
            <span>
              {l.name}
              {(l.choices.length > 0 || l.note) && (
                <small>{[...l.choices, l.note].filter(Boolean).join(", ")}</small>
              )}
            </span>
            <span>{formatRs(l.unitPrice * l.qty)}</span>
          </li>
        ))}
      </ul>
      <dl className={styles.sum}>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatRs(t.subtotal)}</dd>
        </div>
        {delivery && (
          <div>
            <dt>Delivery fee</dt>
            <dd className={t.deliveryFee ? undefined : styles.free}>
              {t.deliveryFee ? formatRs(t.deliveryFee) : "Free"}
            </dd>
          </div>
        )}
        {t.smallOrderFee > 0 && (
          <div>
            <dt>Small order fee</dt>
            <dd>{formatRs(t.smallOrderFee)}</dd>
          </div>
        )}
        {t.saving > 0 && (
          <div className={styles.saving}>
            <dt>Offer: {discountPercent}% off</dt>
            <dd>− {formatRs(t.saving)}</dd>
          </div>
        )}
        {t.promoDiscount > 0 && (
          <div className={styles.saving}>
            <dt>Promo {promoCode}</dt>
            <dd>− {formatRs(t.promoDiscount)}</dd>
          </div>
        )}
        {delivery && t.tip > 0 && (
          <div>
            <dt>Rider tip</dt>
            <dd>{formatRs(t.tip)}</dd>
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
