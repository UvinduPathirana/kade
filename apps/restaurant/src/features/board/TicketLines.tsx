import { Icon, cx } from "@kade/ui";
import type { Ticket } from "@/api/types";
import styles from "./TicketLines.module.css";

/**
 * The dishes as the kitchen reads them: quantity in its own column, options under the name, and the
 * customer's notes boxed so they can't be missed from across the pass.
 */
export function TicketLines({
  ticket,
  size = "md",
  compact,
  className,
}: {
  ticket: Ticket;
  size?: "md" | "lg";
  /** Names and quantities only (ready and picked-up lanes); notes still show. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx(styles.wrap, styles[size], className)}>
      <ul className={styles.lines}>
        {ticket.lines.map((l, i) => (
          <li key={`${l.itemId}-${i}`}>
            <span className={styles.qty}>
              {l.qty}
              <span aria-hidden="true">×</span>
              <span className="kd-visually-hidden"> of</span>
            </span>
            <div className={styles.dish}>
              <strong className={styles.name}>{l.name}</strong>
              {!compact && l.choices.length > 0 && <p className={styles.choices}>{l.choices.join(", ")}</p>}
              {l.note && (
                <p className={styles.note}>
                  <Icon name="chat" size={18} />
                  <span>
                    <span className="kd-visually-hidden">Note: </span>
                    {l.note}
                  </span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {ticket.kitchenNote && (
        <p className={cx(styles.note, styles.orderNote)}>
          <Icon name="doc" size={18} />
          <span>
            <span className={styles.noteLabel}>For the whole order: </span>
            {ticket.kitchenNote}
          </span>
        </p>
      )}
      {!compact && ticket.cutlery && <p className={styles.extra}>Add cutlery</p>}
    </div>
  );
}
