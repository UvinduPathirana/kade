import { Button, Stars, Tag, TextArea, useToast } from "@kade/ui";
import { useState } from "react";
import { useReplyToReview } from "@/api/queries";
import type { Review } from "@/api/types";
import { shortDate } from "@/lib/time";
import styles from "./ReviewCard.module.css";

/** One review with the outlet's single public reply, which can be edited later. */
export function ReviewCard({ review }: { review: Review }) {
  const toast = useToast();
  const reply = useReplyToReview();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply?.text ?? "");
  const [error, setError] = useState("");
  const headingId = `review-${review.id}`;

  const submit = () => {
    if (!text.trim()) return setError("Write a reply, or cancel.");
    reply.mutate(
      { id: review.id, text },
      {
        onSuccess: () => {
          toast({ title: review.reply ? "Reply updated" : "Reply posted", tone: "success" });
          setEditing(false);
          setError("");
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <article className={styles.card} aria-labelledby={headingId}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.name}>
          {review.name}
        </h2>
        <Stars value={review.stars} className={styles.stars} />
        <span className={styles.date}>{shortDate(review.date)}</span>
      </header>
      <p className={styles.dish}>
        <Tag>{review.dish}</Tag>
      </p>
      <p className={styles.text}>{review.text}</p>

      {editing ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextArea
            label={review.reply ? "Edit your reply" : `Reply to ${review.name}`}
            rows={3}
            maxLength={400}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <p className={styles.hint}>
            Everyone can read it on your page. Thank them, and if something went wrong, say what you'll
            change.
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" size="lg" disabled={reply.isPending}>
              {review.reply ? "Save reply" : "Post reply"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setEditing(false);
                setText(review.reply?.text ?? "");
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : review.reply ? (
        <div className={styles.reply}>
          <p className={styles.replyHead}>
            <strong>Your reply</strong>
            <span>{shortDate(review.reply.at)}</span>
          </p>
          <p>{review.reply.text}</p>
          <Button variant="outline" icon="edit" onClick={() => setEditing(true)} className={styles.edit}>
            Edit reply
          </Button>
        </div>
      ) : (
        <Button
          variant={review.stars <= 2 ? "primary" : "outline"}
          size="lg"
          icon="chat"
          onClick={() => setEditing(true)}
        >
          Reply
        </Button>
      )}
    </article>
  );
}
