import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./StatTile.module.css";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Comparison line, e.g. "+12% on last Friday". Tone colours it. */
  change?: ReactNode;
  tone?: "neutral" | "good" | "bad";
  className?: string;
}

/** A number that matters, with its label above and context below. Use only for figures people act on. */
export function StatTile({ label, value, change, tone = "neutral", className }: StatTileProps) {
  return (
    <div className={cx(styles.tile, className)}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
      {change && <dd className={cx(styles.change, styles[tone])}>{change}</dd>}
    </div>
  );
}

/** Wrap StatTiles in this so they form one description list. */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx(styles.group, className)}>{children}</dl>;
}
