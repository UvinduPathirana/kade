import { Chip } from "@kade/ui";
import type { Category } from "@/api/types";
import { imageUrl } from "@/lib/images";
import { filters, type FilterId } from "./filters";
import styles from "./FeedControls.module.css";

export function CategoryRow({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className={styles.categories} aria-label="Categories">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          className={styles.category}
          aria-pressed={value === c.id}
          // Tapping the selected category again goes back to All
          onClick={() => onChange(value === c.id && c.id !== "all" ? "all" : c.id)}
        >
          <img src={imageUrl(c.imageId, 160, 160)} alt="" loading="lazy" />
          {c.label}
        </button>
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
