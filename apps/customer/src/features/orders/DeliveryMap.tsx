import { Icon, cx } from "@kade/ui";
import { useLayoutEffect, useRef, useState } from "react";
import type { OrderMode, OrderStatus } from "@/api/types";
import styles from "./DeliveryMap.module.css";

/*
 * Illustrated map of the delivery, not a tile map: Galle Road running north–south beside the coastal
 * railway and the sea, the restaurant up the road and home on a lane off it. A live map provider
 * replaces this once the rider app sends real positions.
 */

const RESTAURANT = { x: 297, y: 110 };
const HOME = { x: 470, y: 318 };
/** Rider's way to the restaurant: along the cross street, then down Galle Road. */
const APPROACH = "M560 60 L280 60 L297 110";
/** Restaurant to home: down Galle Road, east on the lane, into the gate. */
const ROUTE = "M297 110 L360 300 L470 300 L470 318";

export interface DeliveryMapProps {
  mode: OrderMode;
  status: OrderStatus;
  /** 0–1 along the current leg. */
  progress: number;
  riderName?: string;
}

function usePointOnPath(d: string, t: number) {
  const ref = useRef<SVGPathElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const path = ref.current;
    if (!path) return;
    const p = path.getPointAtLength(path.getTotalLength() * Math.max(0, Math.min(1, t)));
    setPoint({ x: p.x, y: p.y });
  }, [d, t]);
  return [ref, point] as const;
}

export function DeliveryMap({ mode, status, progress, riderName = "Rider" }: DeliveryMapProps) {
  const toRestaurant = status === "accepted" || status === "preparing";
  const onTheWay = status === "pickedUp";
  const arrived = status === "delivered";
  const leg = toRestaurant ? APPROACH : ROUTE;
  const t = arrived ? 1 : toRestaurant || onTheWay ? progress : 0;
  const [pathRef, rider] = usePointOnPath(leg, t);
  const showRider = mode === "delivery" && (toRestaurant || onTheWay || arrived);

  const where = !showRider
    ? mode === "pickup"
      ? "Map from your address to the restaurant, 1.2 km up Galle Road."
      : "Map showing the restaurant on Galle Road and your home on a lane to the south."
    : toRestaurant
      ? `${riderName} is riding to the restaurant.`
      : arrived
        ? `${riderName} is at your gate.`
        : `${riderName} is on Galle Road with your food, ${Math.round(progress * 100)}% of the way.`;

  return (
    <figure className={styles.map}>
      <svg viewBox="0 0 640 420" role="img" aria-label={where} preserveAspectRatio="xMidYMid slice">
        {/* Land, sea and the coastal railway */}
        <rect width="640" height="420" className={styles.land} />
        <path className={styles.sea} d="M0 0 H170 C160 70 205 140 190 210 C180 280 230 340 225 420 H0 Z" />
        <path className={styles.rail} d="M205 0 C200 80 240 150 228 220 C220 290 262 350 258 420" />
        <text className={styles.seaLabel} x="128" y="300" transform="rotate(-80 128 300)">
          Indian Ocean
        </text>

        {/* Parks and blocks */}
        <rect className={styles.park} x="400" y="140" width="110" height="90" rx="10" />
        <rect className={styles.block} x="330" y="330" width="90" height="70" rx="8" />
        <rect className={styles.block} x="520" y="160" width="100" height="110" rx="8" />

        {/* Roads */}
        <g className={styles.roads}>
          <path d="M260 0 L400 420" />
          <path d="M420 0 L560 420" />
          <path d="M240 60 L640 60" />
          <path d="M320 240 L600 240" />
          <path d="M350 300 L540 300" />
          <path d="M470 300 L470 330" className={styles.lane} />
        </g>
        <text className={styles.roadLabel} x="318" y="200" transform="rotate(71.6 318 200)">
          Galle Rd
        </text>
        <text className={styles.roadLabel} x="490" y="140" transform="rotate(71.6 490 140)">
          Duplication Rd
        </text>

        {/* Route: dashed whole way, solid where the rider has already ridden */}
        <path d={ROUTE} className={styles.route} />
        {onTheWay || arrived ? (
          <path d={ROUTE} className={styles.routeDone} pathLength={1} strokeDasharray={`${t} 1`} />
        ) : null}
        {/* Measuring path for the rider's current leg */}
        <path ref={pathRef} d={leg} fill="none" stroke="none" />

        {/* Pins */}
        <g transform={`translate(${RESTAURANT.x} ${RESTAURANT.y})`}>
          <circle r="18" className={styles.pinStore} />
          <Icon name="store" size={20} x={-10} y={-10} className={styles.pinIconLight} />
        </g>
        <g transform={`translate(${HOME.x} ${HOME.y})`}>
          <circle r="18" className={styles.pinHome} />
          <Icon name="home" size={20} x={-10} y={-10} />
        </g>

        {showRider && rider && (
          <g className={cx(styles.rider)} style={{ transform: `translate(${rider.x}px, ${rider.y}px)` }}>
            <circle r="22" className={styles.riderHalo} />
            <circle r="16" className={styles.riderDot} />
            <Icon name="bike" size={18} x={-9} y={-9} className={styles.pinIconLight} />
          </g>
        )}
      </svg>
    </figure>
  );
}
