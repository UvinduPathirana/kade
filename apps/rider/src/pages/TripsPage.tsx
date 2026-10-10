import { EmptyState, Icon, Link, Stars, Tabs, Tag, formatRs, plural } from "@kade/ui";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useRatings, useTrips } from "@/api/queries";
import { payTotal, type Trip } from "@/api/types";
import c from "@/layout/common.module.css";
import { clockTime, dayKey, dayLabel, km } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./TripsPage.module.css";

type View = "trips" | "ratings";

export function TripsPage() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "ratings" ? "ratings" : "trips";
  useDocumentTitle(view === "ratings" ? "Ratings" : "Trips");
  return (
    <div className={c.page}>
      <h1 className={c.heading}>Trips and ratings</h1>
      <Tabs<View>
        label="Trips and ratings"
        value={view}
        onChange={(v) => setParams(v === "ratings" ? { view: v } : {}, { replace: true })}
        items={[
          { value: "trips", label: "Trips" },
          { value: "ratings", label: "Ratings" },
        ]}
      >
        {view === "trips" ? <TripList /> : <Ratings />}
      </Tabs>
    </div>
  );
}

function TripList() {
  const { data, isPending, isError } = useTrips();
  const now = useNow(60_000);
  const [showAll, setShowAll] = useState(false);
  if (isPending) return <p className={c.muted}>Loading trips…</p>;
  if (isError) return <p className={c.error}>Couldn't load your trips. Try again in a moment.</p>;
  if (!data.length)
    return (
      <EmptyState title="No trips yet" description="Go online and your finished trips will show here." />
    );

  const days = new Map<string, Trip[]>();
  for (const t of data) {
    const k = dayKey(t.deliveredAt);
    days.set(k, [...(days.get(k) ?? []), t]);
  }
  const groups = [...days.values()];
  const shown = showAll ? groups : groups.slice(0, 2);

  return (
    <div className={styles.days}>
      {shown.map((trips) => {
        const total = trips.reduce((s, t) => s + payTotal(t.pay), 0);
        const label = dayLabel(trips[0]!.deliveredAt, now);
        return (
          <section key={label} aria-label={label} className={styles.day}>
            <h2 className={styles.dayHead}>
              <span>{label}</span>
              <span className={styles.dayTotal}>
                {formatRs(total)}, {plural(trips.length, "trip")}
              </span>
            </h2>
            <ul className={c.list}>
              {trips.map((t) => (
                <li key={t.id}>
                  <Link href={`/trips/${t.id}`} className={styles.trip}>
                    <span className={styles.time}>{clockTime(t.deliveredAt)}</span>
                    <span className={styles.tripText}>
                      <strong>{t.restaurantName}</strong>
                      <span className={c.muted}>
                        To {t.dropoffArea}, {km(t.km)}
                      </span>
                    </span>
                    <span className={styles.tripPay}>
                      <span className={c.amount}>{formatRs(payTotal(t.pay))}</span>
                      {t.payment === "cash" && <Tag icon="cash">Cash</Tag>}
                    </span>
                    <Icon name="chevronRight" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!showAll && groups.length > 2 && (
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          Show earlier days
        </button>
      )}
    </div>
  );
}

function Ratings() {
  const { data } = useRatings();
  const now = useNow(60_000);
  if (!data) return <p className={c.muted}>Loading ratings…</p>;
  const total = data.breakdown.reduce((s, n) => s + n, 0);
  return (
    <div className={styles.ratings}>
      <div className={styles.overall}>
        <p className={styles.overallValue}>
          {data.overall.toFixed(1)}
          <Icon name="star" size={32} filled className={styles.star} />
        </p>
        <p className={c.muted}>
          From {data.count.toLocaleString("en-LK")} customer ratings. Below 4.5 we'll check in with you.
        </p>
      </div>

      <section className={c.section} aria-labelledby="breakdown-title">
        <h2 id="breakdown-title" className={c.sectionTitle}>
          Your last 100 ratings
        </h2>
        <ul className={styles.breakdown}>
          {data.breakdown.map((n, i) => (
            <li key={i}>
              <span>{plural(5 - i, "star")}</span>
              <span className={styles.meter} aria-hidden="true">
                <span style={{ width: `${(n / total) * 100}%` }} />
              </span>
              <span className={c.amount}>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={c.section} aria-labelledby="compliments-title">
        <h2 id="compliments-title" className={c.sectionTitle}>
          Compliments
        </h2>
        <ul className={styles.compliments}>
          {data.compliments.map((x) => (
            <li key={x.label}>
              <Icon name="thumbUp" size={18} />
              {x.label}
              <strong>{x.count}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className={c.section} aria-labelledby="improve-title">
        <h2 id="improve-title" className={c.sectionTitle}>
          What to work on
        </h2>
        <ul className={c.list}>
          {data.improve.map((x) => (
            <li key={x.label} className={styles.improve}>
              <strong>{x.label}</strong>
              <span className={c.muted}>{x.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={c.section} aria-labelledby="recent-title">
        <h2 id="recent-title" className={c.sectionTitle}>
          Recent ratings
        </h2>
        <ul className={c.list}>
          {data.recent.map((r) => (
            <li key={r.id} className={styles.improve}>
              <span className={styles.recentHead}>
                <Stars value={r.stars} />
                <span className={c.muted}>
                  {dayLabel(r.at, now)}, {r.area}
                </span>
              </span>
              {r.comment && <span>“{r.comment}”</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
