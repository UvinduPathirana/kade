import { Button, formatRs, plural, useToast } from "@kade/ui";
import { useState } from "react";
import { ACCEPT_WINDOW_MS, itemCount } from "@/api/orders";
import { useAcceptTicket, useSettings } from "@/api/queries";
import type { Ticket } from "@/api/types";
import { countdown } from "@/lib/time";
import { RejectFlow } from "./RejectFlow";
import { TicketLines } from "./TicketLines";
import styles from "./NewOrderAlert.module.css";

const PREP_TIMES = [10, 15, 20, 25];

/**
 * The page's one turmeric surface: the order the kitchen has to decide on now. Everything needed to
 * decide is on the card (dishes, notes, time left), and accepting is two taps: prep time, then accept.
 */
export function NewOrderAlert({
  ticket,
  now,
  busyExtra,
}: {
  ticket: Ticket;
  now: number;
  busyExtra: number;
}) {
  const toast = useToast();
  const accept = useAcceptTicket();
  const { data: settings } = useSettings();
  const options = PREP_TIMES.map((m) => m + busyExtra);
  // Remember the kitchen's own estimate; busy mode's extra minutes are added on top, even if it changes
  const [base, setBase] = useState(15);
  const prep = base + busyExtra;
  const [rejecting, setRejecting] = useState(false);
  const left = ticket.acceptBy - now;
  const urgent = left <= 60_000;
  const headingId = `new-${ticket.id}`;

  const onAccept = () =>
    accept.mutate(
      { id: ticket.id, prepMinutes: prep },
      {
        onSuccess: () =>
          toast({
            title: "Order accepted",
            description: `#${ticket.id} is due ready in ${prep} min.${
              settings?.devices.autoPrint ? ` Ticket sent to ${settings.devices.printerName}.` : ""
            }`,
            tone: "success",
          }),
        onError: (e) => toast({ title: "Order not accepted", description: e.message, tone: "error" }),
      },
    );

  return (
    <article className={styles.card} aria-labelledby={headingId} data-urgent={urgent || undefined}>
      <header className={styles.head}>
        <div className={styles.who}>
          <h2 id={headingId} className={styles.number}>
            <span className="kd-visually-hidden">New order </span>#{ticket.id}
          </h2>
          <p className={styles.meta}>
            <strong className={styles.mode}>{ticket.mode === "delivery" ? "Delivery" : "Pickup"}</strong>
            <span>
              {ticket.customerName}
              {ticket.repeatCount > 0 && `, ordered ${plural(ticket.repeatCount, "time")} before`}
            </span>
          </p>
          <p className={styles.meta}>
            <span>
              {plural(itemCount(ticket), "item")}, {formatRs(ticket.subtotal)},{" "}
              {ticket.payment === "card" ? "paid by card" : "cash on delivery"}
            </span>
          </p>
        </div>
        <div className={styles.clock} role="timer" aria-label={`${countdown(left)} left to accept`}>
          <span className={styles.time} aria-hidden="true">
            {countdown(left)}
          </span>
          <span className={styles.clockLabel} aria-hidden="true">
            {urgent ? "Under a minute left" : "left to accept"}
          </span>
        </div>
      </header>

      <div className={styles.bar} aria-hidden="true">
        <span style={{ transform: `scaleX(${Math.max(0, left / ACCEPT_WINDOW_MS)})` }} />
      </div>

      <TicketLines ticket={ticket} size="lg" className={styles.lines} />

      <footer className={styles.foot}>
        <fieldset className={styles.prep}>
          <legend className={styles.prepLabel}>Ready in</legend>
          {options.map((m) => (
            <label key={m} className={styles.prepChip}>
              <input
                type="radio"
                name={`prep-${ticket.id}`}
                value={m}
                checked={prep === m}
                onChange={() => setBase(m - busyExtra)}
              />
              <span>{m} min</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <Button variant="outline" size="lg" className={styles.reject} onClick={() => setRejecting(true)}>
            Reject
          </Button>
          <Button
            variant="ink"
            size="lg"
            className={styles.accept}
            onClick={onAccept}
            disabled={accept.isPending}
          >
            {accept.isPending ? "Accepting…" : "Accept order"}
          </Button>
        </div>
        {busyExtra > 0 && <p className={styles.busy}>Busy mode adds {busyExtra} min to every prep time.</p>}
      </footer>

      <RejectFlow ticket={ticket} open={rejecting} onOpenChange={setRejecting} />
    </article>
  );
}
