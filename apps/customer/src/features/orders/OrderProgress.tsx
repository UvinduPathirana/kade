import { cx } from "@kade/ui";
import type { CSSProperties } from "react";
import type { OrderMode, OrderStatus } from "@/api/types";
import styles from "./OrderProgress.module.css";

const steps: Record<OrderMode, { label: string; reachedAt: OrderStatus[] }[]> = {
  delivery: [
    { label: "Confirmed", reachedAt: ["accepted", "preparing", "pickedUp", "delivered"] },
    { label: "Cooking", reachedAt: ["preparing", "pickedUp", "delivered"] },
    { label: "On the way", reachedAt: ["pickedUp", "delivered"] },
    { label: "Delivered", reachedAt: ["delivered"] },
  ],
  pickup: [
    { label: "Confirmed", reachedAt: ["accepted", "preparing", "ready", "collected"] },
    { label: "Cooking", reachedAt: ["preparing", "ready", "collected"] },
    { label: "Ready", reachedAt: ["ready", "collected"] },
    { label: "Collected", reachedAt: ["collected"] },
  ],
};

/** Four-step progress bar. The current step's bar fills with `progress` (0–1). */
export function OrderProgress({
  mode,
  status,
  progress = 0.5,
  className,
}: {
  mode: OrderMode;
  status: OrderStatus;
  progress?: number;
  className?: string;
}) {
  const list = steps[mode];
  const reached = list.filter((s) => s.reachedAt.includes(status)).length;
  const finished = reached === list.length;
  // While waiting for the kitchen nothing is reached yet, so "Confirmed" is the step in progress
  const current = finished ? -1 : Math.max(0, reached - 1);
  return (
    <ol className={cx(styles.steps, className)} aria-label="Order progress">
      {list.map((s, i) => {
        const done = finished || i < current;
        const isCurrent = i === current;
        return (
          <li
            key={s.label}
            className={cx(done && styles.done, isCurrent && styles.now)}
            aria-current={isCurrent ? "step" : undefined}
            style={
              isCurrent
                ? ({ "--fill": `${Math.round(Math.max(0.15, progress) * 100)}%` } as CSSProperties)
                : undefined
            }
          >
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
