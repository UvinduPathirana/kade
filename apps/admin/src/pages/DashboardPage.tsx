import { Button, Icon, IconButton, StatGroup, StatTile, Switch, cx, formatRs, type IconName } from "@kade/ui";
import { useState } from "react";
import { useLive, useZones } from "@/api/queries";
import type { AttentionItem, AttentionKind, DotKind, LiveSnapshot } from "@/api/types";
import { ColomboMap, MapLegend } from "@/components/ColomboMap";
import { HourChart } from "@/components/HourChart";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import u from "@/components/ui.module.css";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useSecondsSince } from "@/lib/useNow";
import styles from "./DashboardPage.module.css";

const attentionIcon: Record<AttentionKind, IconName> = {
  lateOrder: "timer",
  restaurantNotAccepting: "store",
  riderCash: "cash",
  ridersShort: "bike",
};

const openLabel: Record<AttentionKind, string> = {
  lateOrder: "Open order",
  restaurantNotAccepting: "Open restaurant",
  riderCash: "Open rider",
  ridersShort: "See riders",
};

function UpdatedAgo({ at, paused }: { at: number; paused: boolean }) {
  const s = useSecondsSince(at);
  if (paused) return <>Paused. Showing figures from {s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} ago.</>;
  return <>Updated {s < 2 ? "just now" : `${s} s ago`}</>;
}

function AttentionQueue({ items }: { items: AttentionItem[] }) {
  if (items.length === 0)
    return (
      <p className={styles.calm}>
        Nothing needs you right now. Orders more than 10 minutes late, kitchens that stop accepting and riders
        over their cash limit will appear here.
      </p>
    );
  return (
    <ul className={styles.queue}>
      {items.map((a) => (
        <li key={a.id} className={cx(styles.queueItem, a.kind === "ridersShort" && styles.queueItemQuiet)}>
          <span className={styles.queueIcon} aria-hidden="true">
            <Icon name={attentionIcon[a.kind]} size={18} />
          </span>
          <div className={styles.queueText}>
            <strong>{a.title}</strong>
            <span>{a.detail}</span>
          </div>
          <div className={styles.queueActions}>
            {a.phone && (
              <a className={u.textButton} href={`tel:${a.phone.replaceAll(" ", "")}`}>
                <Icon name="phone" size={16} />
                Call
              </a>
            )}
            <Button size="sm" variant="outline" href={a.href}>
              {openLabel[a.kind]}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Figures({ live }: { live: LiveSnapshot }) {
  const short = live.ridersNeeded - live.ridersOnline;
  const cancelRate = live.ordersToday ? live.cancellationsToday / live.ordersToday : 0;
  const veryLate = live.attention.filter((a) => a.kind === "lateOrder").length;
  return (
    <StatGroup className={styles.figures}>
      <StatTile
        label="Orders in progress"
        value={live.inProgress}
        change={
          live.waitingForRider ? `${live.waitingForRider} without a rider yet` : "Every order has a rider"
        }
        tone={live.waitingForRider > 4 ? "bad" : "neutral"}
      />
      <StatTile
        label="Late orders"
        value={live.late}
        change={live.late ? `${veryLate} more than 10 min late` : "Nothing late"}
        tone={veryLate ? "bad" : "good"}
      />
      <StatTile
        label="Riders online"
        value={
          <>
            {live.ridersOnline}
            <span className={styles.of}> of {live.ridersNeeded} needed</span>
          </>
        }
        change={
          short > 0
            ? `${short} short${live.shortestZone ? `, most in ${live.shortestZone.code}` : ""}`
            : "Enough riders for now"
        }
        tone={short > 2 ? "bad" : "good"}
      />
      <StatTile
        label="Average delivery"
        value={`${live.avgDeliveryMin} min`}
        change="Last 2 hours. Target 35 min"
        tone={live.avgDeliveryMin > 35 ? "bad" : "good"}
      />
      <StatTile
        label="Cancelled today"
        value={live.cancellationsToday}
        change={`${(cancelRate * 100).toFixed(1)}% of ${live.ordersToday} orders`}
        tone={cancelRate > 0.03 ? "bad" : "neutral"}
      />
    </StatGroup>
  );
}

export function DashboardPage() {
  useDocumentTitle("Live");
  const [auto, setAuto] = useState(true);
  // While paused, keep showing the snapshot from the moment of pausing (the sidebar badges keep polling)
  const [frozen, setFrozen] = useState<{ data: LiveSnapshot; at: number } | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const query = useLive(auto);
  const zones = useZones();
  const live = frozen?.data ?? query.data;

  const toggleAuto = (on: boolean) => {
    setAuto(on);
    setFrozen(!on && query.data ? { data: query.data, at: query.dataUpdatedAt } : null);
  };

  const counts = { late: 0, waiting: 0, onTheWay: 0, rider: 0 } as Record<DotKind, number>;
  live?.dots.forEach((d) => counts[d.kind]++);
  const lateOrders = live?.attention.filter((a) => a.kind === "lateOrder").length ?? 0;
  const zoneStat = (id: string) => live?.zones.find((z) => z.id === id);
  const selectedZone = zones.data?.find((z) => z.id === zoneId);
  const shortIds =
    zones.data
      ?.filter((z) => z.open && z.ridersNeeded - (zoneStat(z.id)?.riders ?? 0) >= 2)
      .map((z) => z.id) ?? [];
  const cashHeld = live?.attention.filter((a) => a.kind === "riderCash").length ?? 0;

  return (
    <>
      <PageHeader
        title="Live"
        description={
          live ? (
            <span className={u.num}>
              <UpdatedAgo at={frozen?.at ?? query.dataUpdatedAt} paused={!!frozen} />
            </span>
          ) : (
            "Orders, riders and kitchens across Colombo right now."
          )
        }
        actions={
          <>
            <Switch
              checked={auto}
              onChange={toggleAuto}
              label="Auto-refresh"
              description="Every 5 seconds"
              className={styles.autoSwitch}
            />
            <IconButton
              icon="refresh"
              label="Refresh now"
              variant="soft"
              onClick={() => {
                void query.refetch().then((r) => {
                  if (frozen && r.data) setFrozen({ data: r.data, at: r.dataUpdatedAt });
                });
              }}
            />
          </>
        }
      />

      {/* Announced only when these numbers change, not on every refresh */}
      {live && (
        <p className="kd-visually-hidden" aria-live="polite">
          {`${live.late} late orders. ${live.attention.length} items need attention.`}
        </p>
      )}

      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="live figures"
      />

      {live && (
        <>
          <Figures live={live} />

          <div className={styles.grid}>
            <section className={cx(u.surface, styles.mapPanel)} aria-labelledby="map-title">
              <div className={styles.panelHead}>
                <h2 id="map-title" className={u.sectionTitle}>
                  Orders and riders by zone
                </h2>
                <MapLegend counts={counts} />
              </div>
              <ColomboMap
                label="Map of delivery zones. Choose a zone to see its orders and riders."
                zones={zones.data ?? []}
                dots={live.dots}
                selectedId={zoneId}
                onSelect={(id) => setZoneId(id === zoneId ? null : id)}
                alertIds={shortIds}
                describe={(id) => {
                  const s = zoneStat(id);
                  return s ? `${s.orders} active orders, ${s.riders} riders online` : "";
                }}
              />
              <div className={styles.zoneLine} aria-live="polite">
                {selectedZone ? (
                  <>
                    <p>
                      <strong>
                        {selectedZone.code}
                        {selectedZone.code !== selectedZone.name && `, ${selectedZone.name}`}
                      </strong>
                      <span className={u.muted}>
                        {" "}
                        {selectedZone.open ? "" : "Closed. "}
                        {zoneStat(selectedZone.id)?.orders ?? 0} active orders,{" "}
                        {zoneStat(selectedZone.id)?.riders ?? 0} of {selectedZone.ridersNeeded} riders needed.
                        Delivery from {formatRs(selectedZone.baseFee)}.
                      </span>
                    </p>
                    <Button size="sm" variant="outline" href={`/orders?zone=${selectedZone.id}`}>
                      Orders in {selectedZone.code}
                    </Button>
                  </>
                ) : (
                  <p className={u.muted}>
                    Choose a zone for its numbers. A dashed red edge means the zone is two or more riders
                    short.
                  </p>
                )}
              </div>
            </section>

            <div className={styles.side}>
              <section className={cx(u.surface, styles.attention)} aria-labelledby="attention-title">
                <div className={styles.panelHead}>
                  <h2 id="attention-title" className={u.sectionTitle}>
                    Needs attention <span className={styles.count}>{live.attention.length}</span>
                  </h2>
                  <span className={cx(u.small, u.muted)}>
                    {lateOrders} late, {cashHeld} over cash limit
                  </span>
                </div>
                <AttentionQueue items={live.attention} />
              </section>

              <section className={cx(u.surface, u.surfacePad)} aria-labelledby="hour-title">
                <div className={styles.panelHead}>
                  <h2 id="hour-title" className={u.sectionTitle}>
                    Orders by hour
                  </h2>
                  <span className={cx(u.small, u.muted, u.num)}>{live.ordersToday} today</span>
                </div>
                <HourChart data={live.ordersByHour} currentHour={new Date(live.at).getHours()} />
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
