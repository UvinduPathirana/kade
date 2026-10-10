import { useId, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Switch.module.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Second line under the label, e.g. "Customers can't order this today". */
  description?: ReactNode;
  /** Hide the label visually (keep it for screen readers), e.g. inside a table row. */
  hideLabel?: boolean;
  disabled?: boolean;
  size?: "md" | "lg";
  className?: string;
}

/** On/off setting that takes effect immediately (sold out, busy mode, notifications). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  hideLabel,
  disabled,
  size = "md",
  className,
}: SwitchProps) {
  const id = useId();
  return (
    <div className={cx(styles.row, className)}>
      <span className={cx(styles.text, hideLabel && "kd-visually-hidden")}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={cx(styles.switch, styles[size])}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  );
}
