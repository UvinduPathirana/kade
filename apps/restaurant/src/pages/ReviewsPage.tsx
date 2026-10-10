import { Button, Chip, EmptyState, Stars, plural } from "@kade/ui";
import { useState } from "react";
import { useReviews } from "@/api/queries";
import { ReviewCard } from "@/features/reviews/ReviewCard";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./ReviewsPage.module.css";

type Filter = "all" | "unreplied" | 1 | 2 | 3 | 4 | 5;

export function ReviewsPage() {
  useDocumentTitle("Reviews");
  const { data: reviews, isPending, isError, refetch } = useReviews();
  const [filter, setFilter] = useState<Filter>("all");

  if (isPending) return <p className={styles.muted}>Loading reviews…</p>;
  if (isError)
    return (
      <EmptyState
        title="Reviews didn't load"
        description="Check the tablet's connection and try again."
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );

  const average = reviews.reduce((s, r) => s + r.stars, 0) / (reviews.length || 1);
  const counts = [5, 4, 3, 2, 1].map((n) => ({ n, count: reviews.filter((r) => r.stars === n).length }));
  const most = Math.max(...counts.map((c) => c.count), 1);
  const unreplied = reviews.filter((r) => !r.reply).length;
  const shown = reviews
    .filter((r) => (filter === "all" ? true : filter === "unreplied" ? !r.reply : r.stars === filter))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Reviews</h1>

      <section className={styles.summary} aria-labelledby="summary-title">
        <h2 id="summary-title" className="kd-visually-hidden">
          Rating summary
        </h2>
        <div className={styles.score}>
          <p className={styles.average}>{average.toFixed(1)}</p>
          <Stars value={Math.round(average)} className={styles.bigStars} />
          <p className={styles.muted}>From {plural(reviews.length, "review")} in the last 6 weeks</p>
        </div>
        <ul className={styles.distribution}>
          {counts.map(({ n, count }) => (
            <li key={n}>
              <button
                type="button"
                className={styles.distRow}
                aria-pressed={filter === n}
                onClick={() => setFilter(filter === n ? "all" : (n as Filter))}
              >
                <span className={styles.distLabel}>{plural(n, "star")}</span>
                <span className={styles.distBar} aria-hidden="true">
                  <span style={{ width: `${(count / most) * 100}%` }} />
                </span>
                <span className={styles.distCount}>
                  {count}
                  <span className="kd-visually-hidden"> {count === 1 ? "review" : "reviews"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.filters} role="group" aria-label="Show">
        <Chip pressed={filter === "all"} onClick={() => setFilter("all")} className={styles.chip}>
          All, {reviews.length}
        </Chip>
        <Chip pressed={filter === "unreplied"} onClick={() => setFilter("unreplied")} className={styles.chip}>
          Not replied, {unreplied}
        </Chip>
        {[5, 4, 3, 2, 1].map((n) => (
          <Chip key={n} pressed={filter === n} onClick={() => setFilter(n as Filter)} className={styles.chip}>
            {plural(n, "star")}
          </Chip>
        ))}
      </div>

      {shown.length ? (
        <ul className={styles.list}>
          {shown.map((r) => (
            <li key={r.id}>
              <ReviewCard review={r} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={filter === "unreplied" ? "You've replied to every review" : "No reviews with this rating"}
          action={
            <Button variant="secondary" onClick={() => setFilter("all")}>
              Show all reviews
            </Button>
          }
        />
      )}
    </div>
  );
}
