import { Button, Chip, Icon, formatRs, useToast } from "@kade/ui";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useRateTrip } from "@/api/queries";
import { payTotal, type Thumb } from "@/api/types";
import { jobPath, useJob } from "@/features/job/store";
import c from "@/layout/common.module.css";
import { clockTime } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./JobPages.module.css";

function ThumbChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Thumb | undefined;
  onChange: (v: Thumb | undefined) => void;
}) {
  return (
    <fieldset className={c.fieldset}>
      <legend className={styles.itemText}>
        <strong>{label}</strong>
      </legend>
      <div className={styles.rateRow}>
        <Chip
          icon="thumbUp"
          pressed={value === "up"}
          onClick={() => onChange(value === "up" ? undefined : "up")}
        >
          Good
        </Chip>
        <Chip
          icon="thumbDown"
          pressed={value === "down"}
          onClick={() => onChange(value === "down" ? undefined : "down")}
        >
          Not good
        </Chip>
      </div>
    </fieldset>
  );
}

export function DeliveredPage() {
  const phase = useJob((s) => s.phase);
  const trip = useJob((s) => s.lastTrip);
  const navigate = useNavigate();
  const toast = useToast();
  const rate = useRateTrip();
  const [customer, setCustomer] = useState<Thumb>();
  const [restaurant, setRestaurant] = useState<Thumb>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useDocumentTitle("Delivered");

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (phase !== "delivered" || !trip) return <Navigate to={jobPath(phase) ?? "/"} replace />;

  const finish = (next: "online" | "offline") => {
    if (customer || restaurant) rate.mutate({ tripId: trip.id, customer, restaurant });
    if (next === "online") useJob.getState().backOnline();
    else useJob.getState().goOffline();
    toast({ title: next === "online" ? "You're online" : "You're offline" });
    navigate("/");
  };

  const parts = [
    { label: "Base", amount: trip.pay.base },
    { label: "Distance", amount: trip.pay.distance },
    { label: "Busy-time boost", amount: trip.pay.boost },
    { label: "Tip", amount: trip.pay.tip },
  ].filter((p) => p.amount > 0);

  return (
    <>
      <div className={c.page}>
        <div className={styles.doneHead}>
          <span className={styles.doneIcon}>
            <Icon name="check" size={30} />
          </span>
          <h1 ref={headingRef} tabIndex={-1} className={c.heading}>
            Delivered at {clockTime(trip.deliveredAt)}.
          </h1>
          <p className={c.lead}>
            {trip.customerFirstName}'s order from {trip.restaurantName}.
          </p>
        </div>

        <section className={c.section} aria-labelledby="earned-title">
          <h2 id="earned-title" className={c.figureLabel}>
            You earned on this trip
          </h2>
          <p className={styles.earned}>{formatRs(payTotal(trip.pay))}</p>
          <ul className={c.list}>
            {parts.map((p) => (
              <li key={p.label} className={c.listRow}>
                {p.label}
                <span className={c.amount}>{formatRs(p.amount)}</span>
              </li>
            ))}
          </ul>
          {trip.cashCollected > 0 && (
            <p className={c.muted}>
              {formatRs(trip.cashCollected)} cash added to what you're holding. Your trip pay is set against
              it.
            </p>
          )}
        </section>

        <section className={c.section} aria-labelledby="rate-title">
          <h2 id="rate-title" className={c.sectionTitle}>
            How did it go? Optional
          </h2>
          <ThumbChoice label={trip.customerFirstName} value={customer} onChange={setCustomer} />
          <ThumbChoice
            label={`Pickup at ${trip.restaurantName}`}
            value={restaurant}
            onChange={setRestaurant}
          />
        </section>
      </div>

      <div className={c.sticky}>
        <div className={c.row}>
          <Button variant="secondary" size="lg" className={c.fixed} onClick={() => finish("offline")}>
            Go offline
          </Button>
          <Button size="lg" fullWidth className={c.action} onClick={() => finish("online")}>
            Back online
          </Button>
        </div>
      </div>
    </>
  );
}
