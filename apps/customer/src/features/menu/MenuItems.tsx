import { Icon, Stars, Tag, cx, formatRs } from "@kade/ui";
import type { MenuItem, Review } from "@/api/types";
import { imageUrl } from "@/lib/images";
import styles from "./MenuItems.module.css";

/** The "+" on a dish; shows the quantity once the dish is in the order. */
function AddDot({ qty }: { qty: number }) {
  return (
    <span className={cx(styles.dot, qty > 0 && styles.dotQty)} aria-hidden="true">
      {qty > 0 ? qty : <Icon name="plus" size={18} />}
    </span>
  );
}

const qtyLabel = (qty: number) => (qty ? `, ${qty} in your order` : "");

export function MenuItemRow({ item, qty, onOpen }: { item: MenuItem; qty: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.item}
      disabled={item.soldOut}
      onClick={onOpen}
      aria-label={`${item.name}, ${formatRs(item.price)}${item.soldOut ? ", sold out today" : qtyLabel(qty)}`}
    >
      <span className={styles.text}>
        <span className={styles.name}>{item.name}</span>
        {item.description && <span className={styles.desc}>{item.description}</span>}
        <span className={styles.meta}>
          <span className={styles.price}>{formatRs(item.price)}</span>
          {item.soldOut ? (
            <span className={styles.soldOut}>Sold out today</span>
          ) : (
            item.tags.map((t) => (
              <Tag key={t} tone={t === "Vegetarian" ? "veg" : "hot"}>
                {t}
              </Tag>
            ))
          )}
        </span>
      </span>
      {item.imageId ? (
        <span className={styles.thumb}>
          <img src={imageUrl(item.imageId, 240, 240)} alt="" loading="lazy" />
          {!item.soldOut && <AddDot qty={qty} />}
        </span>
      ) : (
        !item.soldOut && (
          <span className={styles.addOnly}>
            <AddDot qty={qty} />
          </span>
        )
      )}
    </button>
  );
}

export function PopularCard({
  item,
  rank,
  qty,
  onOpen,
}: {
  item: MenuItem;
  rank: number;
  qty: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.pop}
      onClick={onOpen}
      aria-label={`${item.name}, ${formatRs(item.price)}${qtyLabel(qty)}`}
    >
      <span className={styles.popMedia}>
        {item.imageId && <img src={imageUrl(item.imageId, 400, 400)} alt="" loading="lazy" />}
        <span className={styles.rank}>{rank === 1 ? "Most ordered" : `#${rank} most ordered`}</span>
        <AddDot qty={qty} />
      </span>
      <strong>{item.name}</strong>
      <span className={styles.popPrice}>{formatRs(item.price)}</span>
    </button>
  );
}

export function ReviewCard({ review }: { review: Review }) {
  return (
    <figure className={styles.review}>
      <Stars value={review.stars} className={styles.stars} />
      <blockquote>{review.text}</blockquote>
      <figcaption>
        <strong>{review.name}</strong> ordered {review.dish}, {review.when.toLowerCase()}
      </figcaption>
    </figure>
  );
}
