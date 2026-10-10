import type { ReactNode } from "react";
import { Link } from "../../lib/link";
import { IconButton } from "../IconButton/IconButton";
import { Rating } from "../Rating/Rating";
import { Tag } from "../Tag/Tag";
import styles from "./RestaurantCard.module.css";

export interface RestaurantCardProps {
  name: string;
  href: string;
  imageUrl: string;
  rating: number;
  ratingCount?: string;
  /** Time first, always: "15–25 min" or "Ready in 10 min". Rendered in ink, before the other facts. */
  eta: string;
  /** Remaining facts in order, e.g. ["Rs 150 delivery"] or [<span>No delivery fee</span>]. */
  facts?: ReactNode[];
  offer?: string;
  /** When set, the photo is dimmed with this message ("Opens at 8 am"). */
  closedLabel?: string;
  saved?: boolean;
  onToggleSaved?: () => void;
}

/** The restaurant card used in feeds, shelves and search results. The whole card is one link. */
export function RestaurantCard({
  name,
  href,
  imageUrl,
  rating,
  ratingCount,
  eta,
  facts = [],
  offer,
  closedLabel,
  saved,
  onToggleSaved,
}: RestaurantCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <img src={imageUrl} alt="" loading="lazy" />
        {offer && (
          <Tag tone="offer" className={styles.offer}>
            {offer}
          </Tag>
        )}
        {closedLabel && <span className={styles.closed}>{closedLabel}</span>}
      </div>
      {onToggleSaved && (
        <IconButton
          icon="heart"
          variant="overlay"
          size="sm"
          className={styles.save}
          label={`Save ${name} to favourites`}
          pressed={!!saved}
          onClick={onToggleSaved}
        />
      )}
      <div className={styles.body}>
        <div className={styles.title}>
          <h3 className={styles.name}>
            <Link href={href} className={styles.link}>
              {name}
            </Link>
          </h3>
          <Rating value={rating} count={ratingCount} />
        </div>
        <p className={styles.facts}>
          <span className={styles.eta}>{eta}</span>
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </p>
      </div>
    </article>
  );
}
