import { cx } from "@kade/ui";
import type { KeyboardEvent } from "react";
import type { DotKind, MapDot } from "@/api/types";
import styles from "./ColomboMap.module.css";

/*
 * Illustrated map of Kadé's delivery zones: a tile diagram, not a street map. Each postal zone is a
 * tile placed roughly where it sits in the city, hugging the coast from Mattakkuliya down to Mount
 * Lavinia, with the sea, the coastal railway, Galle Road and Beira Lake drawn in for orientation.
 * A real map provider can replace it once riders send live positions.
 */

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROW = 80;
const top = (row: number) => 8 + row * ROW;
const H = ROW - 4;

const TILES: Record<string, Tile> = {
  c15: { x: 196, y: top(0), w: 268, h: H },
  c13: { x: 150, y: top(1), w: 150, h: H },
  c14: { x: 304, y: top(1), w: 160, h: H },
  c01: { x: 96, y: top(2), w: 84, h: H },
  c11: { x: 184, y: top(2), w: 78, h: H },
  c12: { x: 266, y: top(2), w: 78, h: H },
  c10: { x: 348, y: top(2), w: 78, h: H },
  c09: { x: 430, y: top(2), w: 104, h: H },
  c02: { x: 104, y: top(3), w: 140, h: H },
  c08: { x: 248, y: top(3), w: 150, h: H },
  raj: { x: 402, y: top(3), w: 132, h: H + ROW },
  c03: { x: 110, y: top(4), w: 120, h: H },
  c07: { x: 234, y: top(4), w: 164, h: H },
  c04: { x: 118, y: top(5), w: 116, h: H },
  c05: { x: 238, y: top(5), w: 160, h: H + ROW },
  nug: { x: 402, y: top(5), w: 132, h: H + ROW },
  c06: { x: 124, y: top(6), w: 110, h: H },
  deh: { x: 130, y: top(7), w: 170, h: H },
  mtl: { x: 136, y: top(8), w: 164, h: H },
};

const MAP_W = 560;
const MAP_H = top(9) + 4;

const COAST =
  "M200 0 C186 20 172 40 160 70 C146 100 130 120 110 150 C90 180 72 196 70 220 C68 260 80 290 84 366 C88 440 94 470 98 526 C102 590 108 640 112 690 L114 736";
const SEA = `${COAST} L0 736 L0 0 Z`;
/** Galle Road runs south from Fort between the coastal railway and the first row of zones. */
const GALLE_ROAD = "M88 196 C88 250 94 300 98 366 C102 440 108 470 112 526 C116 590 120 640 124 690 L126 736";

export interface MapZone {
  id: string;
  code: string;
  name: string;
  open: boolean;
}

export interface ColomboMapProps {
  zones: MapZone[];
  /** Accessible name for the whole map. */
  label: string;
  dots?: MapDot[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Small line at the foot of each tile, e.g. the base fee "Rs 100". */
  note?: (zoneId: string) => string | undefined;
  /** Extra words for each tile's accessible name, e.g. "9 active orders, 4 riders online". */
  describe?: (zoneId: string) => string;
  /** Zones that need someone to step in (short of riders): chilli dashed edge. */
  alertIds?: string[];
  className?: string;
}

const shortCode = (z: MapZone) => (z.code.startsWith("Colombo") ? z.code.slice(-2) : z.code);

function Dot({ kind }: { kind: DotKind }) {
  switch (kind) {
    case "late":
      return (
        <>
          <circle r="10" className={styles.lateHalo} />
          <circle r="5" className={styles.late} />
        </>
      );
    case "onTheWay":
      return <circle r="4.5" className={styles.onTheWay} />;
    case "waiting":
      return <circle r="4" className={styles.waiting} />;
    case "rider":
      return <rect x="-3.5" y="-3.5" width="7" height="7" transform="rotate(45)" className={styles.rider} />;
  }
}

export function ColomboMap({
  zones,
  label,
  dots = [],
  selectedId,
  onSelect,
  note,
  describe,
  alertIds = [],
  className,
}: ColomboMapProps) {
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  };
  // Draw late dots last so they sit on top
  const order: DotKind[] = ["rider", "waiting", "onTheWay", "late"];
  const sortedDots = dots.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className={cx(styles.map, className)}
      role="group"
      aria-label={label}
    >
      <defs>
        <pattern
          id="closedHatch"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" className={styles.closedFill} />
          <line x1="0" y1="0" x2="0" y2="8" className={styles.hatch} />
        </pattern>
      </defs>

      <g aria-hidden="true">
        <rect width={MAP_W} height={MAP_H} className={styles.land} />
        <path d={SEA} className={styles.sea} />
        <path d={COAST} className={styles.rail} transform="translate(5 0)" />
        <path d={GALLE_ROAD} className={styles.road} />
        <text x="30" y="500" className={styles.seaLabel} transform="rotate(-86 30 500)">
          Indian Ocean
        </text>
        <text x="16" y="100" className={styles.seaLabelSmall}>
          Port of Colombo
        </text>
        <text x="104" y="430" className={styles.roadLabel} transform="rotate(86 104 430)">
          Galle Road
        </text>
      </g>

      {zones.map((z) => {
        const t = TILES[z.id];
        if (!t) return null;
        const selected = selectedId === z.id;
        const interactive = !!onSelect;
        const name = `${z.code}${z.code === z.name ? "" : `, ${z.name}`}`;
        const extra = describe?.(z.id);
        const fee = note?.(z.id);
        return (
          <g
            key={z.id}
            className={cx(
              styles.tile,
              !z.open && styles.closed,
              selected && styles.selected,
              alertIds.includes(z.id) && styles.alert,
              interactive && styles.interactive,
            )}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-pressed={interactive ? selected : undefined}
            aria-label={`${name}${z.open ? "" : ", closed"}${extra ? `: ${extra}` : ""}`}
            onClick={interactive ? () => onSelect(z.id) : undefined}
            onKeyDown={interactive ? (e) => onKey(e, z.id) : undefined}
          >
            <rect x={t.x} y={t.y} width={t.w} height={t.h} rx="9" className={styles.tileShape} />
            <text x={t.x + 9} y={t.y + 19} className={styles.code} aria-hidden="true">
              {shortCode(z)}
            </text>
            {z.code !== z.name && (
              <text x={t.x + 9} y={t.y + 33} className={styles.name} aria-hidden="true">
                {z.name}
              </text>
            )}
            {(fee || !z.open) && (
              <text x={t.x + 9} y={t.y + t.h - 9} className={styles.note} aria-hidden="true">
                {z.open ? fee : "Closed"}
              </text>
            )}
          </g>
        );
      })}

      <ellipse cx="208" cy="306" rx="24" ry="8" className={styles.lake} aria-hidden="true" />

      <g aria-hidden="true">
        {sortedDots.map((d) => {
          const t = TILES[d.zoneId];
          if (!t) return null;
          const x = t.x + 10 + d.x * (t.w - 20);
          const y = t.y + 40 + d.y * (t.h - 48);
          return (
            <g key={d.id} className={styles.dot} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <Dot kind={d.kind} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Key for the dots, with live counts. */
export function MapLegend({ counts }: { counts: Record<DotKind, number> }) {
  const items: [DotKind, string][] = [
    ["late", "Late"],
    ["waiting", "At the restaurant"],
    ["onTheWay", "On the way"],
    ["rider", "Rider free"],
  ];
  return (
    <ul className={styles.legend} aria-label="Map key">
      {items.map(([kind, text]) => (
        <li key={kind}>
          <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true">
            <Dot kind={kind} />
          </svg>
          {text}
          <strong>{counts[kind]}</strong>
        </li>
      ))}
    </ul>
  );
}
