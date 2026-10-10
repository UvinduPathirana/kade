import { Button } from "@kade/ui";
import styles from "./QueryState.module.css";

/** Loading and failure states for a query. Errors say what happened and offer a retry. */
export function QueryState({
  isLoading,
  error,
  onRetry,
  what,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** "orders", "payouts" */
  what: string;
}) {
  if (isLoading)
    return (
      <div className={styles.loading} role="status">
        <span className={styles.bar} aria-hidden="true" />
        Loading {what}…
      </div>
    );
  if (error)
    return (
      <div className={styles.error} role="alert">
        <p>
          <strong>Couldn’t load {what}.</strong>{" "}
          {error instanceof Error ? error.message : "Check your connection, then try again."}
        </p>
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  return null;
}
