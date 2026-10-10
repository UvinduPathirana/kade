import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import { Link } from "../../lib/link";
import styles from "./Button.module.css";

export type ButtonVariant =
  /** Banana leaf. The default action. */
  | "primary"
  /** Steam grey. Secondary or cancel actions. */
  | "secondary"
  /** Outlined pill. Low-emphasis actions next to content. */
  | "outline"
  /** Leaf ink. Strong action on a turmeric surface. */
  | "ink"
  /** Turmeric. Only for the page's single bold action (e.g. "Add to order"). */
  | "turmeric";

export type ButtonSize = "sm" | "md" | "lg";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Content pinned to the far end, e.g. an amount: "Go to checkout ··· Rs 3,110". */
  trailing?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}

type AsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = CommonProps & { href: string; onClick?: () => void; "aria-label"?: string };

export type ButtonProps = AsButton | AsLink;

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, trailing, fullWidth, className, children, ...rest },
  ref,
) {
  const classes = cx(
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.full,
    trailing != null && styles.split,
    className,
  );
  const content = (
    <>
      <span className={styles.label}>
        {icon && <Icon name={icon} size={size === "lg" ? 20 : 18} />}
        {children}
      </span>
      {trailing != null && <span className={styles.trailing}>{trailing}</span>}
    </>
  );

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...linkRest } = rest;
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} href={href} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }
  const { type = "button", ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} className={classes} {...buttonRest}>
      {content}
    </button>
  );
});
