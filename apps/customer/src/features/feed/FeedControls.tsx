import { Chip, Link } from "@kade/ui";
import type { Category } from "@/api/types";
import { imageUrl } from "@/lib/images";
import { filters, type FilterId } from "./filters";
import styles from "./FeedControls.module.css";

/** Each category opens its own page, so it can be shared and the back button works as expected. */
export function CategoryRow({ categories, current }: { categories: Category[]; current?: string }) {
  return (
    <nav className={styles.categories} aria-label="Categories">
      {categories
        .filter((c) => c.id !== "all")
        .map((c) => (
          <Link
            key={c.id}
            href={`/category/${c.id}`}
            className={styles.category}
            aria-current={current === c.id ? "page" : undefined}
          >
            <img src={imageUrl(c.imageId, 160, 160)} alt="" loading="lazy" />
            {c.label}
          </Link>
        ))}
    </nav>
  );
}

export function FilterBar({ active, onToggle }: { active: Set<FilterId>; onToggle: (id: FilterId) => void }) {
  return (
    <div className={styles.filters} role="group" aria-label="Filters">
      {filters.map((f) => (
        <Chip key={f.id} icon={f.icon} pressed={active.has(f.id)} onClick={() => onToggle(f.id)}>
          {f.label}
        </Chip>
      ))}
      <Chip icon="sort" aria-haspopup="listbox" className={styles.sort}>
        Recommended
      </Chip>
    </div>
  );
}
