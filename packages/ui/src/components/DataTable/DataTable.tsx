import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import styles from "./DataTable.module.css";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-align numbers and money. */
  align?: "left" | "right";
  width?: string;
  /** Hide below 760px to keep tables readable on small screens. */
  hideOnNarrow?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible table caption (can be visually hidden). */
  caption: string;
  captionHidden?: boolean;
  /** Makes rows clickable (keyboard too); use for "open this order". */
  onRowClick?: (row: T) => void;
  /** Highlight a row, e.g. the one open in a side panel. */
  selectedKey?: string;
  empty?: ReactNode;
  className?: string;
}

/** Dense table for operations screens: sticky header, tabular numbers, optional row click. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = true,
  onRowClick,
  selectedKey,
  empty,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cx(styles.wrap, className)}>
      <table className={styles.table}>
        <caption className={captionHidden ? "kd-visually-hidden" : styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ width: c.width, textAlign: c.align }}
                className={cx(c.hideOnNarrow && styles.narrowHide)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={cx(onRowClick && styles.clickable, selectedKey === key && styles.selected)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{ textAlign: c.align }}
                    className={cx(c.hideOnNarrow && styles.narrowHide)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty && <div className={styles.empty}>{empty}</div>}
    </div>
  );
}
