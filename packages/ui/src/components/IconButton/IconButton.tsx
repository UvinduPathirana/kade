import { forwardRef, useState, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import { Link } from "../../lib/link";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: icon-only controls need an accessible name. */
  label: string;
  /**
   * plain: transparent, for headers. soft: steam circle. overlay: white circle that sits on a photo.
   */
  variant?: "plain" | "soft" | "overlay";
  size?: "sm" | "md";
  /** Toggle state (e.g. saved to favourites). Fills the icon and turns it chilli while pressed. */
  pressed?: boolean;
  href?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "plain", size = "md", pressed, href, className, onClick, ...rest },
  ref,
) {
  // Restart the "pop" animation each time the toggle changes
  const [bump, setBump] = useState(0);
  const classes = cx(
    styles.button,
    styles[variant],
    styles[size],
    pressed && styles.pressed,
    bump > 0 && (bump % 2 ? styles.popA : styles.popB),
    className,
  );
  const iconEl = <Icon name={icon} size={size === "sm" ? 18 : 20} filled={pressed} />;

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label}>
        {iconEl}
      </Link>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={pressed}
      onClick={(e) => {
        if (pressed !== undefined) setBump((n) => n + 1);
        onClick?.(e);
      }}
      {...rest}
    >
      {iconEl}
    </button>
  );
});
