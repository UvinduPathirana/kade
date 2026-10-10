import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  title: string;
  /** One plain line on what this page is for, or what needs doing on it right now. */
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
