import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./Tabs.module.css";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Small count after the label, e.g. number of new orders. */
  count?: number;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Render the panel for the selected tab. */
  children?: ReactNode;
  className?: string;
}

/** Accessible tabs (arrow keys move between tabs). Underlined style for page sections. */
export function Tabs<T extends string>({ items, value, onChange, label, children, className }: TabsProps<T>) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value);
    const next =
      e.key === "ArrowRight"
        ? i + 1
        : e.key === "ArrowLeft"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length]!;
    onChange(target.value);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${target.value}"]`)?.focus();
  };
  return (
    <div className={className}>
      <div ref={listRef} role="tablist" aria-label={label} className={styles.list} onKeyDown={onKey}>
        {items.map((t) => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`${base}-tab-${t.value}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              data-value={t.value}
              className={cx(styles.tab, selected && styles.selected)}
              onClick={() => onChange(t.value)}
            >
              {t.label}
              {t.count !== undefined && <span className={styles.count}>{t.count}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${value}`}
          className={styles.panel}
        >
          {children}
        </div>
      )}
    </div>
  );
}
