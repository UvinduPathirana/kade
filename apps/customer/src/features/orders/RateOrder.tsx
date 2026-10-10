import { Button, Chip, Icon, Panel, SegmentedControl, StarInput, TextArea, cx, formatRs } from "@kade/ui";
import { useState, type FormEvent } from "react";
import { useRateOrder, useUpdateTip } from "@/api/queries";
import type { Order } from "@/api/types";
import styles from "./RateOrder.module.css";

const praise = ["On time", "Friendly", "Careful with the food", "Followed my note"];
const problems = ["Late", "Food was spilled", "Didn't follow my note", "Hard to reach"];
const tipOptions = [0, 100, 200, 300].map((n) => ({ value: String(n), label: n ? formatRs(n) : "No tip" }));

function DishRating({
  name,
  value,
  onChange,
}: {
  name: string;
  value?: "up" | "down";
  onChange: (v: "up" | "down" | undefined) => void;
}) {
  return (
    <li className={styles.dish}>
      <span>{name}</span>
      <span className={styles.thumbs} role="group" aria-label={`Rate ${name}`}>
        {(["up", "down"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            aria-label={v === "up" ? `Liked ${name}` : `Didn't like ${name}`}
            className={cx(styles.thumb, value === v && (v === "up" ? styles.thumbUp : styles.thumbDown))}
            onClick={() => onChange(value === v ? undefined : v)}
          >
            <Icon name={v === "up" ? "thumbUp" : "thumbDown"} filled={value === v} />
          </button>
        ))}
      </span>
    </li>
  );
}

/** After delivery: rate each dish, rate the rider, change the tip. */
export function RateOrder({ order }: { order: Order }) {
  const rate = useRateOrder();
  const updateTip = useUpdateTip();
  const [dishes, setDishes] = useState<Record<string, "up" | "down">>({});
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();

  const delivery = order.mode === "delivery" && order.rider;
  const riderName = order.rider?.name ?? "your rider";
  const tagOptions = stars >= 4 ? praise : stars > 0 ? problems : [];

  if (order.rating) {
    return (
      <Panel title="Thanks for rating" titleId="rated-title" tone="wash">
        <p className={styles.thanks}>
          {order.restaurant.name}
          {order.rider ? ` and ${order.rider.name}` : ""} will see your rating. It helps other people near you
          choose what to order.
        </p>
      </Panel>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!stars && !Object.keys(dishes).length) {
      setError(
        delivery
          ? `Rate a dish or ${riderName}'s delivery to send your rating.`
          : "Rate a dish to send your rating.",
      );
      return;
    }
    setError(undefined);
    rate.mutate(
      {
        id: order.id,
        rating: { riderStars: stars || undefined, riderTags: tags, dishes, comment: comment.trim() },
      },
      { onError: () => setError("Your rating didn't send. Check your connection and try again.") },
    );
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Panel title="How was the food?" titleId="rate-food">
        <ul className={styles.dishes}>
          {order.lines.map((l) => (
            <DishRating
              key={l.key}
              name={l.name}
              value={dishes[l.itemId]}
              onChange={(v) =>
                setDishes((d) => {
                  const next = { ...d };
                  if (v) next[l.itemId] = v;
                  else delete next[l.itemId];
                  return next;
                })
              }
            />
          ))}
        </ul>
      </Panel>

      {delivery && (
        <Panel title={`How was ${riderName}'s delivery?`} titleId="rate-rider">
          <StarInput
            label={`Rate ${riderName}'s delivery`}
            value={stars}
            onChange={(v) => {
              setStars(v);
              setTags([]);
            }}
          />
          {tagOptions.length > 0 && (
            <div
              className={styles.tags}
              role="group"
              aria-label={stars >= 4 ? "What went well" : "What went wrong"}
            >
              {tagOptions.map((t) => (
                <Chip
                  key={t}
                  pressed={tags.includes(t)}
                  onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                >
                  {t}
                </Chip>
              ))}
            </div>
          )}
        </Panel>
      )}

      {delivery && order.payment.type === "card" && (
        <Panel title={`${riderName}'s tip`} titleId="rate-tip">
          <SegmentedControl
            label="Tip"
            value={String(order.totals.tip)}
            onChange={(v) => updateTip.mutate({ id: order.id, tip: Number(v) })}
            options={
              tipOptions.some((o) => o.value === String(order.totals.tip))
                ? tipOptions
                : [...tipOptions, { value: String(order.totals.tip), label: formatRs(order.totals.tip) }]
            }
          />
          <p className={styles.hint} aria-live="polite">
            {updateTip.isPending
              ? "Updating tip…"
              : updateTip.isSuccess
                ? `Tip changed to ${formatRs(order.totals.tip)}. It goes to ${riderName} in full.`
                : `It goes to ${riderName} in full and is charged to your card.`}
          </p>
        </Panel>
      )}

      <Panel>
        <TextArea
          label="Anything else to tell the restaurant?"
          maxLength={300}
          placeholder="Optional"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className={styles.comment}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className={styles.send} disabled={rate.isPending}>
          {rate.isPending ? "Sending…" : "Send rating"}
        </Button>
      </Panel>
    </form>
  );
}
