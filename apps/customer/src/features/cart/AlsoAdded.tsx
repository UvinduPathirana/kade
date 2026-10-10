import { Icon, formatRs } from "@kade/ui";
import { useMenu } from "@/api/queries";
import { imageUrl } from "@/lib/images";
import { useCart, type CartRestaurant } from "./store";
import styles from "./AlsoAdded.module.css";

/**
 * "People also added": dishes from the same restaurant that aren't in the cart yet and need no
 * choices, so one tap adds them. Dishes with required options stay on the menu, where the sheet asks.
 */
export function AlsoAdded({ restaurant }: { restaurant: CartRestaurant }) {
  const { data: menu } = useMenu(restaurant.id);
  const lines = useCart((s) => s.lines);
  const add = useCart((s) => s.add);
  if (!menu) return null;

  const inCart = new Set(lines.map((l) => l.itemId));
  const picks = menu.sections
    .flatMap((s) => s.items)
    .filter(
      (it) =>
        !it.soldOut && !inCart.has(it.id) && !it.optionGroupIds.some((g) => menu.optionGroups[g]?.required),
    )
    .slice(0, 4);
  if (!picks.length) return null;

  return (
    <section className={styles.section} aria-labelledby="also-title">
      <h2 id="also-title" className={styles.title}>
        People also added
      </h2>
      <ul className={styles.list}>
        {picks.map((it) => (
          <li key={it.id} className={styles.pick}>
            {it.imageId && (
              <img className={styles.thumb} src={imageUrl(it.imageId, 120, 120)} alt="" loading="lazy" />
            )}
            <span className={styles.text}>
              <span className={styles.name}>{it.name}</span>
              <span className={styles.price}>{formatRs(it.price)}</span>
            </span>
            <button
              type="button"
              className={styles.add}
              aria-label={`Add ${it.name}, ${formatRs(it.price)}`}
              onClick={() =>
                add(restaurant, {
                  itemId: it.id,
                  name: it.name,
                  unitPrice: it.price,
                  qty: 1,
                  choices: [],
                  note: "",
                })
              }
            >
              <Icon name="plus" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
