import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Panel.module.css";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Right side of the title row, e.g. "Change". */
  action?: ReactNode;
  /** id for the title, so the panel can be a labelled region. */
  titleId?: string;
  /** outline: bordered panel. wash: steam background, no border. */
  tone?: "outline" | "wash";
  children: ReactNode;
}

/** A titled group of related content: a checkout step, a receipt, an order summary. */
export function Panel({
  title,
  action,
  titleId,
  tone = "outline",
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <section
      className={cx(styles.panel, styles[tone], className)}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {(title || action) && (
        <div className={styles.head}>
          {title && (
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
