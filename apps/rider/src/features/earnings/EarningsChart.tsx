import { cx, formatRs, plural } from "@kade/ui";
import { useState } from "react";
import type { EarningsBar } from "@/api/types";
import styles from "./EarningsChart.module.css";

/**
 * One series, so no legend: leaf bars from a shared baseline. Tap (or focus) a bar to read it in the
 * caption above; the same numbers are in a table underneath for anyone who prefers it.
 */
export function EarningsChart({ bars, title }: { bars: EarningsBar[]; title: string }) {
  const lastWithData = bars.reduce((last, b, i) => (b.amount > 0 ? i : last), bars.length - 1);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = Math.min(picked ?? lastWithData, bars.length - 1);
  const max = Math.max(1, ...bars.map((b) => b.amount));
  const sel = bars[selected];
  // A round gridline value near the top of the scale
  const step = max > 4000 ? 2000 : max > 2000 ? 1000 : 500;
  const grid = Math.floor(max / step) * step;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.caption} aria-live="polite">
        {sel ? (
          <>
            <span className={styles.capLabel}>{sel.fullLabel}</span>
            <strong className={styles.capValue}>{formatRs(sel.amount)}</strong>
            <span className={styles.capLabel}>{plural(sel.trips, "trip")}</span>
          </>
        ) : null}
      </figcaption>

      <div className={styles.plot}>
        {grid > 0 && (
          <div className={styles.grid} style={{ bottom: `${(grid / max) * 100}%` }} aria-hidden="true">
            <span>{formatRs(grid)}</span>
          </div>
        )}
        <div className={styles.bars} role="group" aria-label={title}>
          {bars.map((b, i) => (
            <button
              key={b.fullLabel}
              type="button"
              className={cx(styles.barHit, i === selected && styles.selected)}
              aria-pressed={i === selected}
              aria-label={`${b.fullLabel}: ${formatRs(b.amount)}, ${plural(b.trips, "trip")}`}
              onClick={() => setPicked(i)}
              onFocus={() => setPicked(i)}
            >
              <span
                className={cx(styles.bar, b.amount === 0 && styles.empty)}
                style={{ height: b.amount ? `${Math.max(2, (b.amount / max) * 100)}%` : undefined }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className={styles.axis} aria-hidden="true">
        {bars.map((b, i) => (
          <span key={b.fullLabel} className={cx(i === selected && styles.axisSelected)}>
            {bars.length > 12 && i % 2 === 1 && i !== selected ? "" : b.label}
          </span>
        ))}
      </div>

      <details className={styles.tableToggle}>
        <summary>Show as a table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Trips</th>
              <th scope="col">Earned</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.fullLabel}>
                <th scope="row">{b.fullLabel}</th>
                <td>{b.trips}</td>
                <td>{formatRs(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
