import { Button, Icon, Link, cx, formatRs, plural, useToast } from "@kade/ui";
import { Navigate } from "react-router";
import { useCashBalance, useTodaySummary } from "@/api/queries";
import { cashHolding } from "@/api/types";
import { jobPath, useJob } from "@/features/job/store";
import { RiderMap, type DemandZone } from "@/features/map/RiderMap";
import { MapNote, MapScreen } from "@/layout/MapScreen";
import c from "@/layout/common.module.css";
import { duration } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./GoOnlinePage.module.css";

/** Demand from the dispatch service's heat map; mock for now. */
const ZONES: DemandZone[] = [
  { area: "kollupitiya", level: "veryBusy" },
  { area: "bambalapitiya", level: "busy" },
  { area: "wellawatte", level: "busy" },
];

const zonesInWords = "Kollupitiya is very busy. Bambalapitiya and Wellawatte are busy.";

export function GoOnlinePage() {
  const phase = useJob((s) => s.phase);
  const onlineSince = useJob((s) => s.onlineSince);
  const position = useJob((s) => s.position);
  const { goOnline, goOffline } = useJob.getState();
  const online = phase === "online" || phase === "offer";
  const now = useNow(30_000, online);
  const toast = useToast();
  useDocumentTitle(online ? "Looking for orders" : "Go online");

  const job = jobPath(phase);
  if (job) return <Navigate to={job} replace />;

  return (
    <MapScreen
      label={online ? "Looking for orders" : "You're offline"}
      map={
        <RiderMap
          mode="zones"
          zones={ZONES}
          position={position}
          online={online}
          label={`Map of Colombo's busy areas. ${zonesInWords} ${online ? "You're near Kollupitiya junction." : ""}`}
        />
      }
      overlay={
        <MapNote>
          <Icon name="chart" size={20} />
          <span>Busier than usual in Kollupitiya. Rs 60 boost per trip until 2 pm.</span>
        </MapNote>
      }
    >
      {online ? (
        <>
          <div>
            <h1 className={c.heading}>
              <span className={styles.searching} aria-hidden="true" />
              Looking for orders
            </h1>
            <p className={c.lead}>
              Online for {duration(Math.max(1, ((now - (onlineSince ?? now)) / 60_000) | 0))}. Stay near
              Kollupitiya for the next job.
            </p>
          </div>
          <TodayFigures />
          <Button
            variant="outline"
            size="lg"
            fullWidth
            className={cx(c.action, styles.offline)}
            onClick={() => {
              goOffline();
              toast({ title: "You're offline", description: "No new jobs until you go online." });
            }}
          >
            Go offline
          </Button>
        </>
      ) : (
        <>
          <h1 className={c.heading}>You're offline</h1>
          <TodayFigures />
          <Button
            variant="turmeric"
            size="lg"
            fullWidth
            icon="bike"
            className={c.goOnline}
            onClick={() => {
              goOnline();
              toast({ title: "You're online", description: "Looking for orders near you." });
            }}
          >
            Go online
          </Button>
        </>
      )}
    </MapScreen>
  );
}

function TodayFigures() {
  const today = useTodaySummary();
  const cash = useCashBalance();
  const holding = cash.data ? cashHolding(cash.data) : undefined;
  const over = !!cash.data && holding! >= cash.data.limit;
  const near = !!cash.data && !over && holding! >= cash.data.limit * 0.8;

  return (
    <div className={c.figures}>
      <div className={c.figure}>
        <span className={c.figureLabel}>Today</span>
        <span className={c.figureValue}>{today.data ? formatRs(today.data.amount) : "…"}</span>
        <span className={c.figureNote}>{today.data ? plural(today.data.trips, "trip") : " "}</span>
      </div>
      <Link href="/earnings#cash" className={cx(c.figure, over && c.danger, near && c.warn)}>
        <span className={c.figureLabel}>Cash you're holding</span>
        <span className={c.figureValue}>{holding !== undefined ? formatRs(holding) : "…"}</span>
        <span className={c.figureNote}>
          {over
            ? "Over the limit. Deposit to get cash orders."
            : cash.data && holding !== undefined
              ? `${formatRs(cash.data.limit - holding)} under your limit`
              : " "}
        </span>
      </Link>
    </div>
  );
}
