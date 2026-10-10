import { useRef, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import { IconButton } from "../IconButton/IconButton";
import styles from "./Shelf.module.css";

export interface ShelfProps {
  children: ReactNode;
  /** Accessible name for the arrow buttons: "offers" → "Scroll offers forward". */
  label: string;
  /** Render back/forward arrows (hidden on phones, where people swipe). */
  arrows?: boolean;
  /** Extra controls rendered before the arrows, e.g. a "See all" link. */
  actions?: ReactNode;
  /** Render prop so the caller can place the controls inside its SectionHeader. */
  header?: (controls: ReactNode) => ReactNode;
  className?: string;
}

/** Horizontal row of cards with scroll snapping. Four across on wide screens. */
export function Shelf({ children, label, arrows = true, actions, header, className }: ShelfProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduce ? "auto" : "smooth" });
  };

  const controls = (
    <>
      {actions}
      {arrows && (
        <span className={styles.arrows}>
          <IconButton
            icon="chevronLeft"
            variant="soft"
            size="sm"
            label={`Scroll ${label} back`}
            onClick={() => scroll(-1)}
          />
          <IconButton
            icon="chevronRight"
            variant="soft"
            size="sm"
            label={`Scroll ${label} forward`}
            onClick={() => scroll(1)}
          />
        </span>
      )}
    </>
  );

  return (
    <>
      {header?.(controls)}
      <div ref={ref} className={cx(styles.shelf, className)}>
        {children}
      </div>
    </>
  );
}
