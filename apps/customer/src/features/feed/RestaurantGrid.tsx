import type { Restaurant } from "@/api/types";
import { RestaurantTile } from "./RestaurantTile";
import styles from "./RestaurantGrid.module.css";

/** The home page's restaurant grid, for collection, category and search pages. */
export function RestaurantGrid({ restaurants }: { restaurants: Restaurant[] }) {
  return (
    <div className={styles.grid}>
      {restaurants.map((r) => (
        <RestaurantTile key={r.id} restaurant={r} />
      ))}
    </div>
  );
}
