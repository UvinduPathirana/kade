import { Container, SearchField } from "@kade/ui";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";
import styles from "./MenuNav.module.css";

export interface MenuNavProps {
  sections: { id: string; name: string }[];
  active?: string;
  query: string;
  onQueryChange: (q: string) => void;
  /** "Menu sections" on restaurants, "Aisles" in shops. */
  label?: string;
  searchLabel?: string;
}

/** Sticky section links + menu search. The active link follows the scroll position. */
export function MenuNav({
  sections,
  active,
  query,
  onQueryChange,
  label = "Menu sections",
  searchLabel = "Search the menu",
}: MenuNavProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Keep the active link in view on narrow screens
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLAnchorElement>(`[data-id="${active}"]`);
    if (!list || !link) return;
    list.scrollTo({
      left: link.offsetLeft - list.clientWidth / 2 + link.clientWidth / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [active, reduceMotion]);

  return (
    <nav className={styles.nav} aria-label={label}>
      <Container className={styles.row}>
        <div ref={listRef} className={styles.links}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-id={s.id}
              aria-current={s.id === active ? "true" : undefined}
            >
              {s.name}
            </a>
          ))}
        </div>
        <SearchField
          className={styles.search}
          label={searchLabel}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </Container>
    </nav>
  );
}
