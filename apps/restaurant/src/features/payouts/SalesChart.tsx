import { DataTable, formatRs } from "@kade/ui";
import { useState } from "react";
import { grossOf } from "@/api/payouts";
import type { DailySales } from "@/api/types";
import { shortDate } from "@/lib/time";
import styles from "./SalesChart.module.css";

const W = 720;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

/** Round the axis top up to a tidy step: 50k, 100k, 250k… */
function niceMax(v: number) {
  const steps = [50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 400_000, 500_000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 100_000) * 100_000;
}
const short = (v: number) => (v === 0 ? "0" : `${Math.round(v / 1000)}k`);

/**
 * Gross sales per day as bars (one series, leaf). Hover or focus a bar for its figures; the same
 * numbers are one tap away as a table, which is also what screen readers get.
 */
export function SalesChart({ days }: { days: DailySales[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(...days.map(grossOf), 1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / days.length;
  const barW = Math.max(4, Math.min(48, slot - 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = days.length > 14 ? 5 : 1;
  const best = days.reduce((a, b) => (grossOf(b) > grossOf(a) ? b : a), days[0]!);
  const hovered = active !== null ? days[active] : undefined;

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span>
          Gross sales by day. Best day {shortDate(best.date)}, {formatRs(grossOf(best))}.
        </span>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </figcaption>

      {asTable ? (
        <DataTable
          caption="Sales by day"
          rows={days}
          rowKey={(d) => d.date}
          columns={[
            { key: "date", header: "Day", cell: (d) => shortDate(d.date) },
            { key: "orders", header: "Orders", cell: (d) => d.orders, align: "right" },
            {
              key: "card",
              header: "Card",
              cell: (d) => formatRs(d.card),
              align: "right",
              hideOnNarrow: true,
            },
            {
              key: "cash",
              header: "Cash",
              cell: (d) => formatRs(d.cash),
              align: "right",
              hideOnNarrow: true,
            },
            { key: "gross", header: "Gross sales", cell: (d) => formatRs(grossOf(d)), align: "right" },
          ]}
        />
      ) : (
        <div className={styles.plot} onMouseLeave={() => setActive(null)}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={styles.svg}
            role="img"
            aria-label={`Bar chart of gross sales for ${days.length} days. Use Show as table for the figures.`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className={t === 0 ? styles.base : styles.grid}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t)}
                  className={styles.axis}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {short(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const v = grossOf(d);
              const x = PAD.left + i * slot + (slot - barW) / 2;
              const top = y(v);
              const h = PAD.top + innerH - top;
              const r = Math.min(4, barW / 2, h);
              return (
                <g key={d.date}>
                  <path
                    d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                    className={i === active ? styles.barActive : styles.bar}
                  />
                  {/* Hit area: the whole column, wider than the bar */}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={innerH}
                    fill="transparent"
                    onMouseEnter={() => setActive(i)}
                  />
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={H - 8} className={styles.axis} textAnchor="middle">
                      {days.length > 7
                        ? new Date(`${d.date}T00:00:00`).getDate()
                        : shortDate(d.date).slice(0, 3)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hovered && active !== null && (
            <div
              className={styles.tip}
              style={{ left: `${((PAD.left + (active + 0.5) * slot) / W) * 100}%` }}
              aria-hidden="true"
            >
              <strong>{shortDate(hovered.date)}</strong>
              <span>{formatRs(grossOf(hovered))}</span>
              <span>{hovered.orders} orders</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
