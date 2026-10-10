import { Button, EmptyState, Icon, Stars, Tag, formatRs } from "@kade/ui";
import { useParams } from "react-router";
import { useTrip } from "@/api/queries";
import { payTotal } from "@/api/types";
import { RiderMap } from "@/features/map/RiderMap";
import c from "@/layout/common.module.css";
import { clockTime, dayLabel, duration, km } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./TripDetailPage.module.css";

export function TripDetailPage() {
  const { id = "" } = useParams();
  const { data: trip, isPending, isError } = useTrip(id);
  useDocumentTitle(trip ? `Trip ${trip.orderNumber}` : "Trip");

  if (isPending) return <p className={c.page}>Loading trip…</p>;
  if (isError || !trip)
    return (
      <div className={c.page}>
        <EmptyState
          title="This trip isn't in your history"
          description="It may be older than 30 days. Pick a trip from your list."
          action={<Button href="/trips">Back to trips</Button>}
        />
      </div>
    );

  const steps = [
    { label: "Accepted", at: trip.acceptedAt },
    { label: `Arrived at ${trip.restaurantName}`, at: trip.arrivedAtRestaurantAt },
    { label: "Picked up", at: trip.pickedUpAt },
    { label: `Delivered to ${trip.customerFirstName}`, at: trip.deliveredAt },
  ];
  const parts = [
    { label: "Base", amount: trip.pay.base },
    { label: `Distance, ${km(trip.km)}`, amount: trip.pay.distance },
    { label: "Busy-time boost", amount: trip.pay.boost },
    { label: "Tip", amount: trip.pay.tip },
  ];

  return (
    <div className={c.page}>
      <div>
        <p className={c.figureLabel}>
          {dayLabel(trip.deliveredAt)}, order {trip.orderNumber}
        </p>
        <h1 className={c.heading}>
          {trip.pickupArea} to {trip.dropoffArea}
        </h1>
      </div>

      <div className={styles.map}>
        <RiderMap
          mode="trip"
          from={trip.from}
          pickup={trip.pickupPoint}
          dropoff={trip.dropoffPoint}
          label={`Route from ${trip.restaurantName} in ${trip.pickupArea} to ${trip.dropoffArea}, ${km(trip.km)}.`}
        />
      </div>

      <section className={c.section} aria-labelledby="times-title">
        <h2 id="times-title" className={c.sectionTitle}>
          Times
        </h2>
        <ol className={styles.timeline}>
          {steps.map((s) => (
            <li key={s.label}>
              <span className={styles.dot} aria-hidden="true" />
              <span>{s.label}</span>
              <span className={c.amount}>{clockTime(s.at)}</span>
            </li>
          ))}
        </ol>
        <p className={c.muted}>
          {duration((trip.deliveredAt - trip.acceptedAt) / 60_000)} from accepting to delivered.
        </p>
      </section>

      <section className={c.section} aria-labelledby="pay-title">
        <h2 id="pay-title" className={c.sectionTitle}>
          Pay
        </h2>
        <ul className={c.list}>
          {parts.map((p) => (
            <li key={p.label} className={c.listRow}>
              {p.label}
              <span className={c.amount}>{formatRs(p.amount)}</span>
            </li>
          ))}
          <li className={`${c.listRow} ${styles.total}`}>
            You earned
            <span className={c.amount}>{formatRs(payTotal(trip.pay))}</span>
          </li>
        </ul>
        <p className={styles.facts}>
          {trip.payment === "cash" ? (
            <Tag tone="warning" icon="cash" size="md">
              Cash collected {formatRs(trip.cashCollected)}
            </Tag>
          ) : (
            <Tag icon="card" size="md">
              Paid by card
            </Tag>
          )}
          <Tag icon={trip.proof === "code" ? "lock" : "image"} size="md">
            {trip.proof === "code" ? "Delivery code" : "Photo at the door"}
          </Tag>
        </p>
      </section>

      <section className={c.section} aria-labelledby="rating-title">
        <h2 id="rating-title" className={c.sectionTitle}>
          {trip.customerFirstName}'s rating
        </h2>
        {trip.customerRating ? (
          <Stars value={trip.customerRating} />
        ) : (
          <p className={c.muted}>Not rated yet.</p>
        )}
      </section>

      <Button variant="secondary" size="lg" icon="chat" href="/account#support">
        Get help with this trip
      </Button>
      <Button variant="outline" size="lg" href="/trips">
        <Icon name="chevronLeft" size={18} />
        All trips
      </Button>
    </div>
  );
}
