import type { ReactNode } from "react";
import styles from "./DetailList.module.css";

/** Label/value pairs for side panels. Skips rows whose value is empty. */
export function DetailList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className={styles.list}>
      {items
        .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "")
        .map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** A titled block inside a drawer, separated by a hairline. */
export function DrawerSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
