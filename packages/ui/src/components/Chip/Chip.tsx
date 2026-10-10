import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./Chip.module.css";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  /** Toggle chips (filters) pass true/false; plain action chips leave it undefined. */
  pressed?: boolean;
}

export function Chip({ icon, pressed, className, children, ...rest }: ChipProps) {
  return (
    <button type="button" aria-pressed={pressed} className={cx(styles.chip, className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}
