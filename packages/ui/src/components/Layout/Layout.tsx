import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Link } from "../../lib/link";
import styles from "./Layout.module.css";

/** Centres content at the page max width with responsive gutters. */
export function Container({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.container, className)} {...rest} />;
}

/** The Kadé wordmark. Lowercase on purpose; it is the brand, not a heading. */
export function Wordmark({
  href = "/",
  size = "md",
  className,
}: {
  href?: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(styles.wordmark, styles[`wordmark-${size}`], className)}
      aria-label="Kadé home"
    >
      kadé
    </Link>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Links or controls aligned to the right ("See all", scroll arrows). */
  actions?: ReactNode;
  /** id for the heading, so the section can use aria-labelledby. */
  id?: string;
  level?: 1 | 2 | 3;
}

export function SectionHeader({ title, description, actions, id, level = 2 }: SectionHeaderProps) {
  const H = `h${level}` as const;
  return (
    <div className={styles.sectionHeader}>
      <div>
        <H id={id} className={styles.sectionTitle}>
          {title}
        </H>
        {description && <p className={styles.sectionDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.sectionActions}>{actions}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Empty or no-results state. Says what happened and what to do next. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/** Underlined text link for "See all", "Past orders". */
export function TextLink({ className, ...rest }: { href: string; className?: string; children: ReactNode }) {
  return <Link className={cx(styles.textLink, className)} {...rest} />;
}
