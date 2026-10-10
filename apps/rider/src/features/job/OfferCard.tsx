import { Button, Chip, Icon, formatRs, useToast } from "@kade/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { OFFER_SECONDS, declineReasons } from "@/api/dispatch";
import { useAcceptOffer, useDeclineOffer } from "@/api/queries";
import { payTotal } from "@/api/types";
import { useNow } from "@/lib/useNow";
import { km } from "@/lib/time";
import { useJob } from "./store";
import styles from "./OfferCard.module.css";

const RING = 2 * Math.PI * 92;

/** Announce the time left at these points, not every second. */
function announcement(left: number): string {
  if (left > 20) return "";
  if (left > 10) return "20 seconds left to accept.";
  if (left > 5) return "10 seconds left to accept.";
  if (left > 0) return "5 seconds left to accept.";
  return "";
}

/**
 * The incoming job, full screen on turmeric: the one bold surface while it's showing. Everything a rider
 * needs to decide in 30 seconds, and the two answers within thumb reach.
 */
export function OfferCard() {
  const offer = useJob((s) => s.offer);
  const now = useNow(250);
  const navigate = useNavigate();
  const toast = useToast();
  const accept = useAcceptOffer();
  const decline = useDeclineOffer();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<string>();
  const titleId = useId();
  const descId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Take focus so screen readers start at the offer, without putting it on Accept (no accidental Enter)
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (!offer) return null;

  const left = Math.max(0, Math.ceil((offer.expiresAt - now) / 1000));
  const fraction = Math.max(0, Math.min(1, (offer.expiresAt - now) / (OFFER_SECONDS * 1000)));
  const total = payTotal(offer.pay);
  const totalKm = offer.toPickupKm + offer.tripKm;
  const busy = accept.isPending || decline.isPending;

  const onAccept = () =>
    accept.mutate(offer, {
      onSuccess: (o) => {
        useJob.getState().accept(o);
        toast({ title: "Job accepted", description: `Head to ${o.restaurant.name}.`, tone: "success" });
        navigate("/job/pickup");
      },
      onError: (e) => toast({ title: "Couldn't accept", description: e.message, tone: "error" }),
    });

  const onDecline = () =>
    decline.mutate(
      { offerId: offer.id, reason },
      {
        onSuccess: () => {
          useJob.getState().offerEnded("declined");
          toast({ title: "Offer declined", description: "You're still online." });
        },
      },
    );

  const payParts = [
    { label: "Base", amount: offer.pay.base },
    { label: "Distance", amount: offer.pay.distance },
    { label: "Busy-time boost", amount: offer.pay.boost },
    { label: "Tip", amount: offer.pay.tip },
  ].filter((p) => p.amount > 0);

  return (
    <div
      className={styles.offer}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className={styles.head}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.title}>
          New job
        </h2>
        <span className={styles.orderNo}>{offer.orderNumber}</span>
      </div>

      <p id={descId} className="kd-visually-hidden">
        {formatRs(total)} for {km(totalKm)}, about {offer.minutes} minutes. Pick up at {offer.restaurant.name}
        , {offer.restaurant.area}. Drop off in {offer.customer.area}.
        {offer.payment === "cash"
          ? ` Cash order: collect ${formatRs(offer.cashToCollect)}.`
          : " Paid by card."}{" "}
        {OFFER_SECONDS} seconds to accept.
      </p>
      <p className="kd-visually-hidden" aria-live="assertive">
        {announcement(left)}
      </p>

      <div className={styles.dial}>
        <svg viewBox="0 0 200 200" className={styles.ring} aria-hidden="true">
          <circle cx="100" cy="100" r="92" className={styles.track} />
          <circle
            cx="100"
            cy="100"
            r="92"
            className={styles.remaining}
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - fraction)}
          />
        </svg>
        <div className={styles.dialText}>
          <span className={styles.earn}>{formatRs(total)}</span>
          <span className={styles.left} role="timer" aria-label={`${left} seconds left to accept`}>
            {left} s left
          </span>
        </div>
      </div>

      <ul className={styles.payParts} aria-label="Pay breakdown">
        {payParts.map((p) => (
          <li key={p.label}>
            {p.label} <strong>{formatRs(p.amount)}</strong>
          </li>
        ))}
      </ul>

      {offer.payment === "cash" ? (
        <p className={styles.cash}>
          <Icon name="cash" size={22} />
          <span>
            Cash order. Collect <strong>{formatRs(offer.cashToCollect)}</strong>
          </span>
        </p>
      ) : (
        <p className={styles.card}>
          <Icon name="card" size={20} />
          Paid by card. No cash to collect.
        </p>
      )}

      <ol className={styles.stops}>
        <li>
          <Icon name="store" size={20} className={styles.stopIcon} />
          <span className={styles.stopText}>
            <strong>{offer.restaurant.name}</strong>
            <span>
              {offer.restaurant.area}, {km(offer.toPickupKm)} from you
            </span>
          </span>
        </li>
        <li>
          <Icon name="home" size={20} className={styles.stopIcon} />
          <span className={styles.stopText}>
            <strong>{offer.customer.area}</strong>
            <span>{km(offer.tripKm)} from the restaurant</span>
          </span>
        </li>
      </ol>
      <p className={styles.totals}>
        {km(totalKm)} in all, about {offer.minutes} min
      </p>

      <div className={styles.actions}>
        {declining ? (
          <div className={styles.decline}>
            <fieldset className={styles.reasons}>
              <legend>Why not this one? Optional</legend>
              <div className={styles.reasonChips}>
                {declineReasons.map((r) => (
                  <Chip
                    key={r}
                    pressed={reason === r}
                    onClick={() => setReason(reason === r ? undefined : r)}
                    className={styles.reasonChip}
                  >
                    {r}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <div className={styles.buttons}>
              <Button
                variant="outline"
                size="lg"
                className={styles.outlineInk}
                onClick={() => setDeclining(false)}
              >
                Back
              </Button>
              <Button variant="ink" size="lg" fullWidth disabled={busy} onClick={onDecline}>
                Decline offer
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.buttons}>
            <Button
              variant="outline"
              size="lg"
              className={styles.outlineInk}
              disabled={busy}
              onClick={() => setDeclining(true)}
            >
              Decline
            </Button>
            <Button
              variant="ink"
              size="lg"
              fullWidth
              disabled={busy}
              onClick={onAccept}
              className={styles.accept}
            >
              {accept.isPending ? "Accepting…" : "Accept"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
