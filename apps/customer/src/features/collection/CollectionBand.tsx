import { IconButton } from "@kade/ui";
import type { ReactNode } from "react";
import { imageUrl } from "@/lib/images";
import styles from "./CollectionBand.module.css";

export interface CollectionBandProps {
  title: string;
  description: ReactNode;
  /** The plate on the right, echoing the home hero. */
  imageId?: string;
  children?: ReactNode;
}

/** A category's or collection's title, on the page's one turmeric surface. */
export function CollectionBand({ title, description, imageId, children }: CollectionBandProps) {
  return (
    <section className={styles.band} aria-labelledby="collection-title">
      <div className={styles.copy}>
        <IconButton
          icon="chevronLeft"
          label="Back to home"
          href="/"
          variant="overlay"
          className={styles.back}
        />
        <h1 id="collection-title" className={styles.title}>
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
        {children}
      </div>
      {imageId && (
        <div className={styles.plate} aria-hidden="true">
          <img src={imageUrl(imageId, 600, 600)} alt="" />
        </div>
      )}
    </section>
  );
}
