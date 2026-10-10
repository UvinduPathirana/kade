import type { ReactNode } from "react";
import styles from "./Toolbar.module.css";

export interface ToolbarProps {
  /** Labelled filter controls. */
  children: ReactNode;
  /** "32 orders": announced politely when filters change the result. */
  count?: string;
  onClear?: () => void;
  label?: string;
}

/** The filter row above a table. Every control inside keeps a visible or screen-reader label. */
export function Toolbar({ children, count, onClear, label = "Filters" }: ToolbarProps) {
  return (
    <div className={styles.toolbar} role="search" aria-label={label}>
      <div className={styles.controls}>{children}</div>
      <div className={styles.meta}>
        {onClear && (
          <button type="button" className={styles.clear} onClick={onClear}>
            Clear filters
          </button>
        )}
        {count && (
          <p className={styles.count} aria-live="polite">
            {count}
          </p>
        )}
      </div>
    </div>
  );
}
