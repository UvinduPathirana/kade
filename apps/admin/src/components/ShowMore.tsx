import { Button } from "@kade/ui";
import styles from "./ShowMore.module.css";

/** "Showing 50 of 312" with a button for the next page. */
export function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <div className={styles.more}>
      <span>
        Showing {shown} of {total}
      </span>
      <Button size="sm" variant="secondary" onClick={onMore}>
        Show {Math.min(50, total - shown)} more
      </Button>
    </div>
  );
}
