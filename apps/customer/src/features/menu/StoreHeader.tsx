import { Button, Container, Icon, IconButton, Rating, SegmentedControl, Tag, formatRs } from "@kade/ui";
import { useEffect, useRef, useState } from "react";
import type { Restaurant } from "@/api/types";
import { useCart } from "@/features/cart/store";
import { useFavourites } from "@/features/feed/favourites";
import { pickupMinutes } from "@/lib/eta";
import { imageUrl } from "@/lib/images";
import styles from "./StoreHeader.module.css";

function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.coverBtn}
      onClick={async () => {
        try {
          if (navigator.share) await navigator.share({ title, url: location.href });
          else {
            await navigator.clipboard.writeText(location.href);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }
        } catch {
          // Share sheet dismissed
        }
      }}
    >
      <Icon name="share" />
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

function HoursPopover({ restaurant: r }: { restaurant: Restaurant }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close when clicking anywhere else
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return (
    <details ref={ref} className={styles.info}>
      <summary className={styles.pill}>
        <Icon name="clock" size={18} />
        Hours and address
        <Icon name="chevronDown" size={16} className={styles.chevron} />
      </summary>
      <dl className={styles.infoBody}>
        <dt>Address</dt>
        <dd>214 Galle Rd, {r.area}, Colombo</dd>
        <dt>Open</dt>
        <dd>Every day, {r.hours}</dd>
        <dt>Minimum order</dt>
        <dd>None. Small orders under Rs 500 add a Rs 60 fee.</dd>
      </dl>
    </details>
  );
}

export function StoreHeader({
  restaurant: r,
  onStartGroup,
}: {
  restaurant: Restaurant;
  onStartGroup: () => void;
}) {
  const mode = useCart((s) => s.mode);
  const setMode = useCart((s) => s.setMode);
  const saved = useFavourites((s) => s.ids.includes(r.id));
  const toggleSaved = useFavourites((s) => s.toggle);

  return (
    <Container className={styles.top}>
      <div className={styles.cover}>
        <img src={imageUrl(r.imageId, 1600, 500)} alt="" />
        <div className={styles.coverActions}>
          <IconButton
            icon="chevronLeft"
            variant="overlay"
            label="Back to restaurants"
            href="/"
            className={styles.back}
          />
          <IconButton
            icon="heart"
            variant="overlay"
            label={`Save ${r.name} to favourites`}
            pressed={saved}
            onClick={() => toggleSaved(r.id)}
          />
          <ShareButton title={r.name} />
        </div>
      </div>

      <div className={styles.head}>
        <div>
          <h1 className={styles.name}>{r.name}</h1>
          <p className={styles.facts}>
            <Rating value={r.rating} size="md" />
            <span>
              <strong>{r.ratingCount}</strong> ratings
            </span>
            <span>
              {r.area}, {r.distanceKm.toFixed(1)} km away
            </span>
            <span>Open {r.hours}</span>
          </p>
          {r.offer && (
            <Tag tone="offerSoft" icon="tag" size="md" className={styles.offer}>
              {r.offer}
              {r.discountPercent ? ", taken off at checkout" : ""}
            </Tag>
          )}
          {r.closedLabel && (
            <div className={styles.closed}>
              <strong>Closed now. {r.closedLabel}.</strong> You can look through the menu and order once it
              opens.
            </div>
          )}
        </div>

        <SegmentedControl
          variant="card"
          className={styles.service}
          label="Order type"
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "delivery",
              label: "Delivery",
              detail: `${r.eta[0]}–${r.eta[1]} min, ${r.deliveryFee ? `${formatRs(r.deliveryFee)} fee` : "no fee"}`,
            },
            { value: "pickup", label: "Pickup", detail: `Ready in ${pickupMinutes(r.eta)} min` },
          ]}
        />

        <div className={styles.more}>
          <Button variant="outline" size="sm" icon="users" aria-haspopup="dialog" onClick={onStartGroup}>
            Start a group order
          </Button>
          <HoursPopover restaurant={r} />
        </div>
      </div>
    </Container>
  );
}
