import type { ReactNode } from "react";
import { Icon, type IconName } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./Tag.module.css";

export type TagTone =
  /** Grey, for neutral facts. */
  | "neutral"
  /** Leaf tint, for vegetarian. */
  | "veg"
  /** Chilli tint, for spicy dishes. */
  | "hot"
  /** Solid chilli, for offers on photos ("20% off kottu"). */
  | "offer"
  /** Chilli tint with icon, for an offer line in text. */
  | "offerSoft"
  /** Leaf tint, for success states ("Free delivery"). */
  | "positive";

export interface TagProps {
  tone?: TagTone;
  icon?: IconName;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}

export function Tag({ tone = "neutral", icon, size = "sm", className, children }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[tone], styles[size], className)}>
      {icon && <Icon name={icon} size={size === "md" ? 16 : 14} />}
      {children}
    </span>
  );
}
