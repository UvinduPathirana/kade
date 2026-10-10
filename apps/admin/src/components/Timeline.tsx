import type { TimelineEvent } from "@/api/types";
import { formatClock } from "@/lib/format";
import styles from "./Timeline.module.css";

/** What happened to an order, oldest first. It is a real sequence, so it's an ordered list. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  const sorted = events.slice().sort((a, b) => a.at - b.at);
  return (
    <ol className={styles.timeline}>
      {sorted.map((e, i) => (
        <li key={`${e.at}-${i}`} className={styles.event}>
          <time className={styles.time}>{formatClock(e.at)}</time>
          <span className={styles.text}>
            {e.label}
            {e.by && <span className={styles.by}>{e.by}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
