import { useId } from "react";
import styles from "./HourChart.module.css";

export interface HourPoint {
  hour: number;
  today: number;
  lastWeek: number;
}

const hourLabel = (h: number) =>
  h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`;

/**
 * Orders per hour today as bars, with last Saturday as a tick on each bar for comparison. The SVG
 * carries a one-sentence summary; the full numbers are in a table underneath.
 */
export function HourChart({ data, currentHour }: { data: HourPoint[]; currentHour: number }) {
  const id = useId();
  const W = 640;
  const H = 150;
  const pad = { top: 10, bottom: 22, left: 28 };
  const max = Math.max(10, ...data.map((d) => Math.max(d.today, d.lastWeek)));
  const step = (W - pad.left) / Math.max(data.length, 1);
  const barW = Math.min(26, step * 0.62);
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max);
  const peak = data.reduce(
    (p, d) => (d.today > p.today ? d : p),
    data[0] ?? { hour: 0, today: 0, lastWeek: 0 },
  );
  const total = data.reduce((s, d) => s + d.today, 0);
  const totalLast = data.reduce((s, d) => s + d.lastWeek, 0);
  const summary = `${total} orders since 7 am, against ${totalLast} by this time last Saturday. Busiest hour so far: ${hourLabel(peak.hour)} with ${peak.today}.`;
  const gridLines = [0, Math.round(max / 2), max];

  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-labelledby={`${id}-sum`}>
        <title id={`${id}-sum`}>{summary}</title>
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={W} y1={y(v)} y2={y(v)} className={styles.grid} />
            <text x={pad.left - 6} y={y(v) + 4} className={styles.axis} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.left + step * i + step / 2;
          const isNow = d.hour === currentHour;
          return (
            <g key={d.hour}>
              <rect
                x={cx - barW / 2}
                y={y(d.today)}
                width={barW}
                height={Math.max(0, y(0) - y(d.today))}
                rx="3"
                className={isNow ? styles.barNow : styles.bar}
              />
              <line
                x1={cx - barW / 2 - 3}
                x2={cx + barW / 2 + 3}
                y1={y(d.lastWeek)}
                y2={y(d.lastWeek)}
                className={styles.tick}
              />
              {(i % 2 === 0 || isNow) && (
                <text x={cx} y={H - 6} className={styles.axis} textAnchor="middle">
                  {isNow ? "Now" : hourLabel(d.hour)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.caption}>
        <span className={styles.keyBar} aria-hidden="true" /> Today
        <span className={styles.keyTick} aria-hidden="true" /> Last Saturday
        <span className={styles.keyNow} aria-hidden="true" /> This hour so far
      </figcaption>
      <details className={styles.details}>
        <summary>Show as a table</summary>
        <table className={styles.table}>
          <caption className="kd-visually-hidden">Orders per hour, today and last Saturday</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Today</th>
              <th scope="col">Last Saturday</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.hour}>
                <th scope="row">{hourLabel(d.hour)}</th>
                <td>{d.today}</td>
                <td>{d.lastWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
