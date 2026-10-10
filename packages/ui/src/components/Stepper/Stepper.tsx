import { Icon } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./Stepper.module.css";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  /** What is being counted, for screen readers: "Quantity of Fish bun". */
  label: string;
  min?: number;
  max?: number;
  size?: "sm" | "md";
  /** Name of the item, so the minus button can say "Remove Fish bun" when it would remove it. */
  itemName?: string;
  className?: string;
}

export function Stepper({
  value,
  onChange,
  label,
  min = 0,
  max = 99,
  size = "sm",
  itemName,
  className,
}: StepperProps) {
  const removes = min === 0 && value === 1;
  return (
    <div role="group" aria-label={label} className={cx(styles.stepper, styles[size], className)}>
      <button
        type="button"
        aria-label={removes && itemName ? `Remove ${itemName}` : "One fewer"}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" size={size === "md" ? 18 : 16} />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Icon name="plus" size={size === "md" ? 18 : 16} />
      </button>
    </div>
  );
}
