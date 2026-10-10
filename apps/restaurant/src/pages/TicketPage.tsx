import { Button, EmptyState, Tag, formatRs, plural, type TagTone } from "@kade/ui";
import { useParams } from "react-router";
import { itemCount, rejectReasons, riderState } from "@/api/orders";
import { useTicket } from "@/api/queries";
import type { Ticket, TicketStatus } from "@/api/types";
import { TicketLines } from "@/features/board/TicketLines";
import { clockTime, shortDate, useNow } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./TicketPage.module.css";

const statusTag: Record<TicketStatus, [string, TagTone]> = {
  new: ["Waiting to accept", "warning"],
  preparing: ["Preparing", "neutral"],
  ready: ["Ready", "positive"],
  pickedUp: ["Picked up", "neutral"],
  missed: ["Missed", "hot"],
  rejected: ["Rejected", "dark"],
};

function timeline(t: Ticket): Array<[string, number | undefined, string?]> {
  const steps: Array<[string, number | undefined, string?]> = [["Placed", t.placedAt]];
  if (t.status === "missed") return [...steps, ["Missed, customer refunded", t.acceptBy]];
  if (t.status === "rejected")
    return [
      ...steps,
      [
        `Rejected: ${t.rejectReason === "other" ? t.rejectNote : rejectReasons[t.rejectReason ?? "other"]}`,
        t.closedAt,
      ],
    ];
  return [
    ...steps,
    [
      "Accepted",
      t.acceptedAt,
      t.prepMinutes ? `${t.prepMinutes} min prep, due ${clockTime(t.readyBy!)}` : undefined,
    ],
    ["Ready", t.readyAt],
    [t.mode === "delivery" ? "Picked up by rider" : "Collected", t.pickedUpAt],
  ];
}

/** One order as a kitchen ticket. Prints as a black-and-white 80mm receipt. */
export function TicketPage() {
  const { id = "" } = useParams();
  const now = useNow(5000);
  const { data: ticket, isPending } = useTicket(id);
  useDocumentTitle(`Order #${id}`);

  if (isPending) return <p className={styles.loading}>Loading order #{id}…</p>;
  if (!ticket)
    return (
      <EmptyState
        title={`Order #${id} isn't on the board any more`}
        description="Orders leave the board an hour after they're finished. Find older orders in your weekly statement."
        action={<Button href="/">Back to live orders</Button>}
      />
    );

  const [label, tone] = statusTag[ticket.status];
  const rider = riderState(ticket, now);

  return (
    <div className={styles.page}>
      <article className={styles.ticket} data-print aria-labelledby="ticket-number">
        <p className={styles.outlet}>Galle Road Kottu House, Kollupitiya</p>
        <h1 id="ticket-number" className={styles.number}>
          <span className="kd-visually-hidden">Order </span>#{ticket.id}
        </h1>
        <p className={styles.mode}>{ticket.mode === "delivery" ? "Delivery" : "Pickup at the counter"}</p>

        <dl className={styles.facts}>
          <div>
            <dt>Customer</dt>
            <dd>
              {ticket.customerName}
              {ticket.repeatCount > 0 && (
                <small> (ordered {plural(ticket.repeatCount, "time")} before)</small>
              )}
            </dd>
          </div>
          <div>
            <dt>Placed</dt>
            <dd>
              {shortDate(ticket.placedAt)}, {clockTime(ticket.placedAt)}
            </dd>
          </div>
          {ticket.readyBy && (
            <div>
              <dt>Due ready</dt>
              <dd>{clockTime(ticket.readyBy)}</dd>
            </div>
          )}
          {ticket.rider && (
            <div>
              <dt>Rider</dt>
              <dd>
                {ticket.rider.name}, {ticket.rider.vehicle} <small>{ticket.rider.plate}</small>
              </dd>
            </div>
          )}
        </dl>

        <div className={styles.rule} aria-hidden="true" />
        <TicketLines ticket={ticket} size="lg" />
        {!ticket.cutlery && <p className={styles.small}>No cutlery</p>}
        <div className={styles.rule} aria-hidden="true" />

        <dl className={styles.total}>
          <div>
            <dt>{plural(itemCount(ticket), "item")}</dt>
            <dd>{formatRs(ticket.subtotal)}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>
              {ticket.payment === "card"
                ? "Paid by card"
                : ticket.mode === "delivery"
                  ? "Cash, rider collects"
                  : "Cash at the counter"}
            </dd>
          </div>
        </dl>

        <h2 className={styles.timelineTitle}>Timeline</h2>
        <ol className={styles.timeline}>
          {timeline(ticket).map(([what, at, detail]) => (
            <li key={what} data-done={at ? true : undefined}>
              <span className={styles.when}>{at ? clockTime(at) : "–"}</span>
              <span>
                {what}
                {detail && <small>{detail}</small>}
              </span>
            </li>
          ))}
        </ol>
      </article>

      <aside className={styles.side} aria-label="Order status and actions">
        <Tag tone={tone} size="md">
          {label}
        </Tag>
        {ticket.status === "ready" && rider.kind !== "pickup" && (
          <p className={styles.sideText}>
            {rider.kind === "waiting"
              ? `${rider.rider.name} is waiting at the counter.`
              : rider.kind === "onTheWay"
                ? `${rider.rider.name} is on the way.`
                : "Finding a rider."}
          </p>
        )}
        <Button size="lg" icon="printer" onClick={() => window.print()} fullWidth>
          Print ticket
        </Button>
        <Button size="lg" variant="secondary" href="/" fullWidth>
          Back to live orders
        </Button>
        <p className={styles.sideHint}>Prints in black and white for 80mm kitchen printers.</p>
      </aside>
    </div>
  );
}
