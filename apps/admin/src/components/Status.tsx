import { cx } from "@kade/ui";
import type { ReactNode } from "react";
import styles from "./Status.module.css";

/**
 * The console's status grammar, shared with the live map's dots:
 * - live: filled leaf (moving, online, active)
 * - progress: leaf ring (waiting on someone)
 * - done: grey (finished, offline)
 * - alert: chilli (someone must step in)
 * - stopped: ink square (paused, suspended, blocked)
 */
export type StatusTone = "live" | "progress" | "done" | "alert" | "stopped";

export function Status({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx(styles.status, styles[tone], className)}>
      <span className={styles.mark} aria-hidden="true" />
      {children}
    </span>
  );
}
