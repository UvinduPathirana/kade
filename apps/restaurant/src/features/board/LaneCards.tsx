import type { ReactNode } from "react";
import { Button, Icon, Link, Tag, cx, formatRs, plural, useToast } from "@kade/ui";
import { itemCount, rejectReasons, riderState } from "@/api/orders";
import { useHandOver, useMarkReady } from "@/api/queries";
import type { Ticket } from "@/api/types";
import { clockTime, countdown, minutes } from "@/lib/time";
import { TicketLines } from "./TicketLines";
import styles from "./LaneCards.module.css";

const modeLabel = (t: Ticket) => (t.mode === "delivery" ? "Delivery" : "Pickup");

function CardHead({ ticket, children }: { ticket: Ticket; children?: ReactNode }) {
  return (
    <header className={styles.head}>
      <div>
        <h3 className={styles.number}>
          <Link href={`/orders/${ticket.id}`} className={styles.numberLink}>
            <span className="kd-visually-hidden">Order </span>#{ticket.id}
          </Link>
        </h3>
        <p className={styles.meta}>
          {modeLabel(ticket)}, {ticket.customerName}
        </p>
      </div>
      {children}
    </header>
  );
}

/** Cooking: prep timer counting down, then "late" in chilli once it passes. */
export function PreparingCard({ ticket, now }: { ticket: Ticket; now: number }) {
  const toast = useToast();
  const markReady = useMarkReady();
  const left = (ticket.readyBy ?? now) - now;
  const late = left < 0;
  const total = (ticket.prepMinutes ?? 15) * 60_000;
  const done = Math.min(1, 1 - left / total);

  return (
    <article className={cx(styles.card, late && styles.late)} aria-label={`Order #${ticket.id}, preparing`}>
      <CardHead ticket={ticket}>
        <div className={styles.timer} role="timer">
          <span className={styles.timerLabel}>{late ? "Late by" : "Ready in"}</span>
          <span className={styles.timerValue}>{late ? minutes(-left) : countdown(left)}</span>
        </div>
      </CardHead>
      <div className={styles.progress} aria-hidden="true">
        <span style={{ transform: `scaleX(${done})` }} />
      </div>
      <TicketLines ticket={ticket} />
      <Button
        size="lg"
        fullWidth
        icon="check"
        className={styles.action}
        disabled={markReady.isPending}
        onClick={() =>
          markReady.mutate(ticket.id, {
            onSuccess: (t) =>
              toast({
                title: "Marked ready",
                description:
                  t.mode === "delivery"
                    ? `#${t.id} is waiting for ${t.rider?.name ?? "a rider"}.`
                    : `${t.customerName} has been told #${t.id} is ready to collect.`,
                tone: "success",
              }),
            onError: (e) => toast({ title: "Not marked ready", description: e.message, tone: "error" }),
          })
        }
      >
        Mark ready
      </Button>
    </article>
  );
}

/** Packed and waiting: shows where the rider is, and hands over once they're at the counter. */
export function ReadyCard({ ticket, now }: { ticket: Ticket; now: number }) {
  const toast = useToast();
  const handOver = useHandOver();
  const rider = riderState(ticket, now);
  const canHandOver = rider.kind === "waiting" || rider.kind === "pickup";
  const label =
    rider.kind === "pickup"
      ? `${ticket.customerName} collected`
      : rider.kind === "waiting"
        ? `Handed to ${rider.rider.name}`
        : "";

  return (
    <article className={styles.card} aria-label={`Order #${ticket.id}, ready`}>
      <CardHead ticket={ticket}>
        <Tag tone="positive" size="md">
          Ready {clockTime(ticket.readyAt ?? now)}
        </Tag>
      </CardHead>

      <div className={cx(styles.rider, rider.kind === "waiting" && styles.riderHere)}>
        <Icon name={rider.kind === "pickup" ? "user" : "bike"} size={24} />
        {rider.kind === "pickup" && <p>Waiting for {ticket.customerName} to collect</p>}
        {rider.kind === "finding" && <p>Finding a rider</p>}
        {rider.kind === "onTheWay" && (
          <p>
            {rider.rider.name} is on the way, about {minutes(rider.arrivesIn)}
            <small>
              {rider.rider.vehicle}, {rider.rider.plate}
            </small>
          </p>
        )}
        {rider.kind === "waiting" && (
          <p>
            {rider.rider.name} is waiting at the counter
            <small>
              {rider.waitingFor < 60_000 ? "Just arrived" : `Waiting ${minutes(rider.waitingFor)}`},{" "}
              {rider.rider.plate}
            </small>
          </p>
        )}
      </div>

      <TicketLines ticket={ticket} compact />

      {canHandOver ? (
        <Button
          size="lg"
          fullWidth
          className={styles.action}
          disabled={handOver.isPending}
          onClick={() =>
            handOver.mutate(ticket.id, {
              onSuccess: () =>
                toast({
                  title: rider.kind === "pickup" ? "Order collected" : "Order handed over",
                  tone: "success",
                }),
              onError: (e) => toast({ title: "Not handed over", description: e.message, tone: "error" }),
            })
          }
        >
          {label}
        </Button>
      ) : (
        <p className={styles.hint}>Hand over when the rider shows order #{ticket.id}.</p>
      )}
    </article>
  );
}

/** Recent history: picked up, plus missed and rejected orders shown plainly. */
export function DoneRow({ ticket }: { ticket: Ticket }) {
  const rider = ticket.rider?.name;
  return (
    <li>
      <Link href={`/orders/${ticket.id}`} className={styles.done}>
        <span className={styles.doneNumber}>#{ticket.id}</span>
        <span className={styles.doneText}>
          {ticket.status === "pickedUp" && (
            <>
              {ticket.mode === "delivery"
                ? `Picked up by ${rider ?? "rider"}`
                : `Collected by ${ticket.customerName}`}
              <small>
                {clockTime(ticket.pickedUpAt ?? 0)}, {plural(itemCount(ticket), "item")},{" "}
                {formatRs(ticket.subtotal)}
              </small>
            </>
          )}
          {ticket.status === "missed" && (
            <>
              <Tag tone="hot" icon="alert">
                Missed
              </Tag>
              <small>
                Not accepted by {clockTime(ticket.acceptBy)}. {ticket.customerName} was told and refunded.
              </small>
            </>
          )}
          {ticket.status === "rejected" && (
            <>
              <Tag tone="dark">Rejected</Tag>
              <small>
                {ticket.rejectReason === "other"
                  ? ticket.rejectNote
                  : rejectReasons[ticket.rejectReason ?? "other"]}
                , {clockTime(ticket.closedAt ?? 0)}
              </small>
            </>
          )}
        </span>
        <Icon name="chevronRight" size={20} />
      </Link>
    </li>
  );
}

/** Other orders waiting behind the one on the alert card. Tapping one brings it to the alert card. */
export function WaitingCard({ ticket, now, onShow }: { ticket: Ticket; now: number; onShow: () => void }) {
  const left = ticket.acceptBy - now;
  return (
    <li>
      <button
        type="button"
        className={styles.waiting}
        onClick={onShow}
        data-urgent={left <= 60_000 || undefined}
      >
        <span className={styles.waitingTop}>
          <strong className={styles.waitingNumber}>#{ticket.id}</strong>
          <span className={styles.waitingTime} role="timer">
            {countdown(left)}
            <span className="kd-visually-hidden"> left to accept</span>
          </span>
        </span>
        <span className={styles.waitingMeta}>
          {modeLabel(ticket)}, {plural(itemCount(ticket), "item")}
        </span>
        <span className={styles.waitingShow}>Show order</span>
      </button>
    </li>
  );
}
