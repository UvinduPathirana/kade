import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./SegmentedControl.module.css";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Second line, used by the "card" variant (e.g. "15–25 min, Rs 150 fee"). */
  detail?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Order type". */
  label: string;
  /** pill: compact header toggle. card: larger options that carry their own facts. */
  variant?: "pill" | "card";
  /** Tints the track for use on a coloured surface such as the turmeric band. */
  onColor?: boolean;
  className?: string;
}

/** A small set of mutually exclusive buttons. Uses aria-pressed so each option reads as a toggle. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = "pill",
  onColor,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(styles.track, styles[variant], onColor && styles.onColor, className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={styles.option}
          onClick={() => onChange(o.value)}
        >
          <strong>{o.label}</strong>
          {variant === "card" && o.detail && <span>{o.detail}</span>}
        </button>
      ))}
    </div>
  );
}
