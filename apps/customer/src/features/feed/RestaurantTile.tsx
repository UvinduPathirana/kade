import { RestaurantCard, formatRs } from "@kade/ui";
import type { Restaurant } from "@/api/types";
import { useCart } from "@/features/cart/store";
import { etaLabel } from "@/lib/eta";
import { imageUrl } from "@/lib/images";
import { useFavourites } from "./favourites";
import styles from "./RestaurantTile.module.css";

/** Maps a Restaurant to the design system's RestaurantCard for the current order mode. */
export function RestaurantTile({ restaurant: r }: { restaurant: Restaurant }) {
  const mode = useCart((s) => s.mode);
  const saved = useFavourites((s) => s.ids.includes(r.id));
  const toggle = useFavourites((s) => s.toggle);

  const eta = etaLabel(r.eta, mode);
  const fact =
    mode === "pickup" ? (
      `${r.distanceKm.toFixed(1)} km`
    ) : r.deliveryFee === 0 ? (
      <span className={styles.free}>No delivery fee</span>
    ) : (
      `${formatRs(r.deliveryFee)} delivery`
    );

  return (
    <RestaurantCard
      name={r.name}
      href={`/restaurant/${r.id}`}
      imageUrl={imageUrl(r.imageId)}
      rating={r.rating}
      ratingCount={r.ratingCount}
      eta={eta}
      facts={[fact]}
      offer={r.offer}
      closedLabel={r.closedLabel}
      saved={saved}
      onToggleSaved={() => toggle(r.id)}
    />
  );
}
