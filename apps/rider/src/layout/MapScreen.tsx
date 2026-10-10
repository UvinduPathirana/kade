import { Icon, cx, type IconName } from "@kade/ui";
import type { ReactNode } from "react";
import styles from "./MapScreen.module.css";

/**
 * Map-first screen: the map takes whatever height is left, and a white dock holds the facts and the
 * one main action at the bottom, where the thumb already is.
 */
export function MapScreen({
  map,
  overlay,
  children,
  label,
}: {
  map: ReactNode;
  /** Sits on the map's top edge, e.g. the next turn or a busy-area note. */
  overlay?: ReactNode;
  children: ReactNode;
  /** Names the dock region for screen readers. */
  label: string;
}) {
  return (
    <div className={styles.screen}>
      <div className={styles.mapArea}>
        {map}
        {overlay && <div className={styles.overlay}>{overlay}</div>}
      </div>
      <section className={styles.dock} aria-label={label}>
        {children}
      </section>
    </div>
  );
}

/** Next-turn card on the map: big, white on ink, readable at a glance on a mount. */
export function Hud({
  icon = "navigation",
  title,
  detail,
}: {
  icon?: IconName;
  title: string;
  detail: string;
}) {
  return (
    <div className={styles.hud}>
      <Icon name={icon} size={28} />
      <div>
        <p className={styles.hudTitle}>{title}</p>
        <p className={styles.hudDetail}>{detail}</p>
      </div>
    </div>
  );
}

/** A quiet note on the map, e.g. "Busier than usual". */
export function MapNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.note, className)}>{children}</div>;
}
