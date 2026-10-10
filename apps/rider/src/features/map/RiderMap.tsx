import { Icon, cx } from "@kade/ui";
import { useLayoutEffect, useRef, useState } from "react";
import type { MapPoint } from "@/api/types";
import { AREAS, CROSS_STREETS, DUPLICATION_X, GALLE_X, VIEW, routePath } from "./geo";
import styles from "./RiderMap.module.css";

/*
 * Illustrated map of Colombo's coast (adapted from the customer app's DeliveryMap), drawn for a phone
 * on a handlebar mount in full sun: thicker roads, darker labels, a heavy route line. The land runs
 * well past the viewBox so the "camera" can frame any route without showing an edge.
 */

export type DemandLevel = "busy" | "veryBusy";

export interface DemandZone {
  area: keyof typeof AREAS;
  level: DemandLevel;
}

type Mode =
  | { mode: "zones"; position: MapPoint; online: boolean; zones: DemandZone[] }
  | { mode: "route"; from: MapPoint; to: MapPoint; progress: number; destination: "store" | "home" }
  | { mode: "trip"; from: MapPoint; pickup: MapPoint; dropoff: MapPoint };

export type RiderMapProps = Mode & {
  /** What the map shows, in words, for screen readers. */
  label: string;
  className?: string;
};

function usePointOnPath(d: string, t: number) {
  const ref = useRef<SVGPathElement>(null);
  const [point, setPoint] = useState<MapPoint | null>(null);
  useLayoutEffect(() => {
    const path = ref.current;
    if (!path) return;
    const p = path.getPointAtLength(path.getTotalLength() * Math.max(0, Math.min(1, t)));
    setPoint({ x: p.x, y: p.y });
  }, [d, t]);
  return [ref, point] as const;
}

/** A viewBox that fits the given points with padding, at least 260 units tall so it never zooms too far. */
function frame(points: MapPoint[]): string {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 70;
  let minX = Math.min(...xs) - pad;
  let maxX = Math.max(...xs) + pad;
  let minY = Math.min(...ys) - pad;
  let maxY = Math.max(...ys) + pad;
  const minSize = 260;
  if (maxY - minY < minSize) {
    const c = (minY + maxY) / 2;
    minY = c - minSize / 2;
    maxY = c + minSize / 2;
  }
  if (maxX - minX < minSize) {
    const c = (minX + maxX) / 2;
    minX = c - minSize / 2;
    maxX = c + minSize / 2;
  }
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

function Base({ showAreaLabels }: { showAreaLabels: boolean }) {
  return (
    <>
      <rect x={-400} y={-400} width={1200} height={1400} className={styles.land} />
      {/* Sea and the coastal railway */}
      <path
        className={styles.sea}
        d="M-400 -400 H90 C80 -100 110 60 98 200 C88 320 112 440 100 560 C94 700 104 900 100 1000 H-400 Z"
      />
      <path
        className={styles.rail}
        d="M116 -400 C112 -100 124 60 118 200 C112 320 128 440 120 560 C116 700 122 900 120 1000"
      />
      <text className={styles.seaLabel} x={54} y={360} transform="rotate(-90 54 360)">
        Indian Ocean
      </text>

      {/* Parks and blocks */}
      <rect className={styles.park} x={290} y={200} width={100} height={80} rx={10} />
      <rect className={styles.park} x={180} y={520} width={50} height={60} rx={8} />
      <rect className={styles.block} x={175} y={80} width={55} height={70} rx={6} />
      <rect className={styles.block} x={280} y={420} width={110} height={60} rx={6} />

      <g className={styles.roads}>
        {CROSS_STREETS.map((s) => (
          <path key={s.y} d={`M${GALLE_X - 20} ${s.y} H800`} />
        ))}
        <path d={`M${GALLE_X} -400 V1000`} className={styles.major} />
        <path d={`M${DUPLICATION_X} -400 V1000`} className={styles.major} />
        <path d="M360 -400 V1000" />
      </g>
      <text className={styles.roadLabel} x={GALLE_X - 6} y={250} transform={`rotate(-90 ${GALLE_X - 6} 250)`}>
        Galle Rd
      </text>
      <text
        className={styles.roadLabel}
        x={DUPLICATION_X + 18}
        y={250}
        transform={`rotate(90 ${DUPLICATION_X + 18} 250)`}
      >
        Duplication Rd
      </text>

      {showAreaLabels &&
        Object.values(AREAS).map((a) => (
          <text key={a.name} className={styles.areaLabel} x={a.point.x} y={a.point.y + 4} textAnchor="middle">
            {a.name}
          </text>
        ))}
    </>
  );
}

function Pin({ at, kind }: { at: MapPoint; kind: "store" | "home" }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <circle r={20} className={kind === "store" ? styles.pinStore : styles.pinHome} />
      <Icon
        name={kind}
        size={22}
        x={-11}
        y={-11}
        className={kind === "store" ? styles.iconLight : undefined}
      />
    </g>
  );
}

function Rider({ at, pulse, muted }: { at: MapPoint; pulse?: boolean; muted?: boolean }) {
  return (
    <g className={styles.rider} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
      {pulse && <circle r={22} className={styles.pulse} />}
      <circle r={26} className={styles.halo} />
      <circle r={17} className={cx(styles.riderDot, muted && styles.riderMuted)} />
      <Icon name="navigation" size={18} x={-9} y={-9} className={styles.iconLight} />
    </g>
  );
}

export function RiderMap(props: RiderMapProps) {
  const { label, className } = props;
  const leg = props.mode === "route" ? routePath(props.from, props.to) : "M0 0";
  const t = props.mode === "route" ? props.progress : 0;
  const [pathRef, rider] = usePointOnPath(leg, t);

  let viewBox = `0 0 ${VIEW.w} ${VIEW.h}`;
  // Leave room above the busiest zone for the note that sits over the top of the map
  if (props.mode === "zones") viewBox = `0 -80 ${VIEW.w} ${VIEW.h}`;
  if (props.mode === "route") viewBox = frame([props.from, props.to]);
  if (props.mode === "trip") viewBox = frame([props.from, props.pickup, props.dropoff]);

  return (
    <figure className={cx(styles.map, className)}>
      <svg viewBox={viewBox} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        <Base showAreaLabels={props.mode !== "zones"} />

        {props.mode === "zones" && (
          <>
            <g aria-hidden="true">
              {props.zones.map((z) => {
                const a = AREAS[z.area];
                return (
                  <g key={z.area}>
                    <ellipse
                      cx={a.point.x}
                      cy={a.point.y}
                      rx={z.level === "veryBusy" ? 110 : 90}
                      ry={z.level === "veryBusy" ? 70 : 56}
                      className={z.level === "veryBusy" ? styles.zoneHot : styles.zoneWarm}
                    />
                    <text className={styles.zoneLabel} x={a.point.x} y={a.point.y + 24} textAnchor="middle">
                      {z.level === "veryBusy" ? "Very busy" : "Busy"}
                    </text>
                  </g>
                );
              })}
            </g>
            {Object.values(AREAS).map((a) => (
              <text
                key={`${a.name}-top`}
                className={styles.areaLabel}
                x={a.point.x}
                y={a.point.y + 4}
                textAnchor="middle"
              >
                {a.name}
              </text>
            ))}
            <Rider at={props.position} pulse={props.online} muted={!props.online} />
          </>
        )}

        {props.mode === "route" && (
          <>
            <path d={leg} className={styles.routeCasing} />
            <path d={leg} className={styles.route} />
            <path d={leg} className={styles.routeDone} pathLength={1} strokeDasharray={`${t} 1`} />
            <path ref={pathRef} d={leg} fill="none" stroke="none" />
            <Pin at={props.to} kind={props.destination} />
            {rider && <Rider at={rider} />}
          </>
        )}

        {props.mode === "trip" && (
          <>
            <path d={routePath(props.from, props.pickup)} className={styles.routeFaint} />
            <path d={routePath(props.pickup, props.dropoff)} className={styles.routeCasing} />
            <path d={routePath(props.pickup, props.dropoff)} className={styles.route} />
            <Pin at={props.pickup} kind="store" />
            <Pin at={props.dropoff} kind="home" />
          </>
        )}
      </svg>
    </figure>
  );
}
