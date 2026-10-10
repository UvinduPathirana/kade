import { RestaurantCard, Tag } from "@kade/ui";
import type { Menu, OfferInput } from "@/api/types";
import { imageUrl, photos } from "@/lib/images";
import { offerTerms, offerTitle } from "./offerText";
import styles from "./OfferPreview.module.css";

/** How the offer looks to customers: the feed card's offer tag, and the line on the menu page. */
export function OfferPreview({ offer, menu }: { offer: OfferInput; menu?: Menu }) {
  const title = offerTitle(offer, menu);
  const terms = offerTerms(offer);
  return (
    <div className={styles.preview} aria-live="polite">
      <h2 className={styles.title}>What customers see</h2>
      {/* inert: a picture of the card, not a link to anywhere */}
      <div className={styles.card} inert>
        <RestaurantCard
          name="Galle Road Kottu House"
          href="/"
          imageUrl={imageUrl(photos.kottu, 640, 400)}
          rating={4.8}
          ratingCount="3k+"
          eta="15–25 min"
          facts={[offer.type === "freeDelivery" ? "No delivery fee" : "Rs 150 delivery"]}
          offer={title}
        />
      </div>
      <p className={styles.caption}>On the home feed and in search</p>
      <div className={styles.menuLine}>
        <Tag tone="offerSoft" icon="tag" size="md">
          {title}
        </Tag>
        {terms && <p>{terms}</p>}
      </div>
      <p className={styles.caption}>At the top of your menu page</p>
    </div>
  );
}
