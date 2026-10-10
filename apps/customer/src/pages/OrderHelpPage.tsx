import { Button, Choice, Container, EmptyState, Icon, Stepper, TextArea, formatRs, plural } from "@kade/ui";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useParams } from "react-router";
import { OrderError, issueAmount } from "@/api/orders";
import { orderStatus } from "@/api/orderStatus";
import { useCredit, useOrder, useReportIssue } from "@/api/queries";
import type { IssueKind, IssueResolution, Order } from "@/api/types";
import { issueKinds, needsItems } from "@/features/help/issues";
import { itemsSummary, orderDate } from "@/features/orders/format";
import { SiteHeader } from "@/layout/SiteHeader";
import { cardLabel } from "@/lib/cards";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./OrderHelpPage.module.css";

type Step = "problem" | "items" | "details" | "photo" | "resolution";

const MAX_PHOTO_MB = 10;

function stepsFor(kind: IssueKind | null): Step[] {
  if (!kind) return ["problem"];
  if (needsItems(kind)) return ["problem", "items", "photo", "resolution"];
  if (kind === "charged") return ["problem", "details", "photo"];
  return ["problem", "resolution"];
}

/** After sending: the page's turmeric band says what happens to the money, in one sentence. */
function Resolved({ order }: { order: Order }) {
  const { data: credit } = useCredit();
  const issue = order.issue!;
  const card = order.payment.type === "card" ? cardLabel(order.payment) : "your card";
  const copy =
    issue.resolution === "credit"
      ? {
          headline: `${formatRs(issue.amount)} is in your Kadé credit.`,
          detail: `It's there now, ready for your next order${credit ? `. Your balance is ${formatRs(credit.balance)}` : ""}.`,
        }
      : issue.resolution === "card"
        ? {
            headline: `${formatRs(issue.amount)} is on its way back to ${card}.`,
            detail: "Refunds usually show on your statement within 5 to 7 working days.",
          }
        : {
            headline: "Sent to our payments team.",
            detail: "They'll check the charge with your bank and text you within one working day.",
          };
  return (
    <>
      <section className={styles.band} aria-live="polite" aria-labelledby="resolved-title">
        <p className={styles.bandFrom}>
          Order {order.id} from {order.restaurant.name}
        </p>
        <h1 id="resolved-title" className={styles.bandTitle}>
          {copy.headline}
        </h1>
        <p className={styles.bandDetail}>{copy.detail}</p>
      </section>
      <div className={styles.doneActions}>
        <Button href="/orders">Back to orders</Button>
        <Button variant="outline" href={`/support?order=${order.id}`}>
          Chat with support
        </Button>
      </div>
    </>
  );
}

function HelpFlow({ order }: { order: Order }) {
  const report = useReportIssue();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState<IssueKind | null>(null);
  const [step, setStep] = useState<Step>("problem");
  const [affected, setAffected] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [resolution, setResolution] = useState<IssueResolution>("credit");
  const [error, setError] = useState<string | undefined>();

  const paidByCard = order.payment.type === "card";
  const steps = stepsFor(kind);
  const index = steps.indexOf(step);
  const lines = Object.entries(affected).map(([key, qty]) => ({ key, qty }));
  const amount = kind ? issueAmount(order, { kind, lines }) : 0;
  const kinds = issueKinds.filter((k) => order.mode === "delivery" || !k.deliveryOnly);

  // Free the preview's memory when it's replaced or the page closes
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const go = (next: Step) => {
    setError(undefined);
    setStep(next);
    // Each step's question gets focus, so screen readers hear where they are
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step === "problem" && !kind) return setError("Choose what went wrong to continue.");
    if (step === "items" && !lines.length) return setError("Tick the dishes that were affected.");
    if (step === "details" && !note.trim())
      return setError("Tell us what looks wrong with the charge, for example the amount you expected.");
    const following = steps[index + 1];
    if (following) return go(following);
    void send();
  };

  const send = async () => {
    if (!kind) return;
    setError(undefined);
    try {
      await report.mutateAsync({
        id: order.id,
        issue: {
          kind,
          lines,
          note: note.trim(),
          photoName: photo?.name,
          resolution: kind === "charged" ? "review" : resolution,
        },
      });
    } catch (err) {
      setError(
        err instanceof OrderError ? err.message : "That didn't send. Check your connection and try again.",
      );
    }
  };

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/"))
      return setPhotoError("That file isn't a photo. Choose a JPG, PNG or HEIC image.");
    if (file.size > MAX_PHOTO_MB * 1024 * 1024)
      return setPhotoError(
        `That photo is over ${MAX_PHOTO_MB} MB. Choose a smaller one or take a new photo.`,
      );
    setPhotoError(undefined);
    setPhoto({ name: file.name, url: URL.createObjectURL(file) });
  };

  const toggleLine = (key: string, max: number, on: boolean) =>
    setAffected((prev) => {
      const nextState = { ...prev };
      if (on) nextState[key] = max;
      else delete nextState[key];
      return nextState;
    });

  const questions: Record<Step, string> = {
    problem: "What went wrong?",
    items:
      kind === "wrong"
        ? "Which dishes were wrong?"
        : kind === "spilled"
          ? "Which dishes were damaged?"
          : "What was missing?",
    details: "What looks wrong with the charge?",
    photo: "Add a photo",
    resolution: "How would you like it back?",
  };

  const last = index === steps.length - 1;

  return (
    <form className={styles.flow} onSubmit={next} noValidate>
      <p className={styles.progress}>
        Step {index + 1} of {steps.length}
      </p>
      <h2 ref={headingRef} tabIndex={-1} className={styles.question}>
        {questions[step]}
      </h2>

      {step === "problem" && (
        <fieldset className={styles.fieldset}>
          <legend className="kd-visually-hidden">What went wrong?</legend>
          {kinds.map((k) => (
            <Choice
              key={k.value}
              type="radio"
              name="kind"
              checked={kind === k.value}
              onChange={() => {
                setKind(k.value);
                setError(undefined);
              }}
              label={
                <span className={styles.choiceText}>
                  <strong>{k.label}</strong>
                  <span>{k.detail}</span>
                </span>
              }
            />
          ))}
        </fieldset>
      )}

      {step === "items" && (
        <fieldset className={styles.fieldset}>
          <legend className="kd-visually-hidden">{questions.items}</legend>
          {order.lines.map((l) => {
            const picked = affected[l.key];
            return (
              <div key={l.key} className={styles.lineRow}>
                <Choice
                  type="checkbox"
                  checked={picked !== undefined}
                  onChange={(e) => {
                    toggleLine(l.key, l.qty, e.target.checked);
                    setError(undefined);
                  }}
                  label={
                    <span className={styles.choiceText}>
                      <strong>{l.name}</strong>
                      <span>{[...l.choices, l.note, `${l.qty} ordered`].filter(Boolean).join(", ")}</span>
                    </span>
                  }
                />
                {picked !== undefined && l.qty > 1 && (
                  <Stepper
                    value={picked}
                    min={1}
                    max={l.qty}
                    onChange={(q) => setAffected((prev) => ({ ...prev, [l.key]: q }))}
                    label={`How many ${l.name}`}
                  />
                )}
              </div>
            );
          })}
          <TextArea
            label="Anything else we should know?"
            maxLength={300}
            placeholder="For example: the faluda lid came off in the bag"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </fieldset>
      )}

      {step === "details" && (
        <TextArea
          label="Describe the problem"
          maxLength={500}
          placeholder="For example: I was charged Rs 2,130 twice on my card"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(undefined);
          }}
          className={styles.details}
        />
      )}

      {step === "photo" && (
        <div className={styles.photoStep}>
          <p className={styles.muted}>
            Optional.{" "}
            {kind === "charged"
              ? "A screenshot of your bank statement helps the payments team."
              : "A photo helps the restaurant fix what went wrong."}
          </p>
          {photo ? (
            <figure className={styles.preview}>
              <img src={photo.url} alt={`Your photo, ${photo.name}`} />
              <figcaption>
                <span>{photo.name}</span>
                <Button variant="secondary" size="sm" icon="trash" onClick={() => setPhoto(null)}>
                  Remove photo
                </Button>
              </figcaption>
            </figure>
          ) : (
            <label className={styles.upload}>
              <input type="file" accept="image/*" onChange={onPhoto} className="kd-visually-hidden" />
              <Icon name="image" />
              <span>
                <strong>Choose a photo</strong>
                <span>JPG, PNG or HEIC, up to {MAX_PHOTO_MB} MB</span>
              </span>
            </label>
          )}
          {photoError && (
            <p className={styles.error} role="alert">
              {photoError}
            </p>
          )}
        </div>
      )}

      {step === "resolution" && (
        <fieldset className={styles.fieldset}>
          <legend className="kd-visually-hidden">How would you like it back?</legend>
          <p className={styles.amount}>
            {kind === "late"
              ? `For the wait, we'll give you ${formatRs(amount)}.`
              : kind === "neverArrived"
                ? `We'll give back the full ${formatRs(amount)}.`
                : `${plural(
                    lines.reduce((n, l) => n + l.qty, 0),
                    "dish",
                    "dishes",
                  )}, ${formatRs(amount)} back.`}
          </p>
          <Choice
            type="radio"
            name="resolution"
            checked={resolution === "credit"}
            onChange={() => setResolution("credit")}
            label={
              <span className={styles.choiceText}>
                <strong>Kadé credit</strong>
                <span>Instant. It comes off your next order automatically.</span>
              </span>
            }
            meta={formatRs(amount)}
          />
          <Choice
            type="radio"
            name="resolution"
            checked={resolution === "card"}
            disabled={!paidByCard}
            onChange={() => setResolution("card")}
            label={
              <span className={styles.choiceText}>
                <strong>
                  {paidByCard
                    ? `Refund to ${cardLabel(order.payment as { brand: string; last4: string })}`
                    : "Refund to a card"}
                </strong>
                <span>
                  {paidByCard
                    ? "Shows in 5 to 7 working days"
                    : "You paid in cash, so the refund goes to your Kadé credit"}
                </span>
              </span>
            }
            meta={paidByCard ? formatRs(amount) : undefined}
          />
        </fieldset>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.nav}>
        {index > 0 && (
          <Button variant="secondary" onClick={() => go(steps[index - 1]!)}>
            Back
          </Button>
        )}
        <Button type="submit" disabled={report.isPending}>
          {report.isPending
            ? "Sending…"
            : !last
              ? "Continue"
              : kind === "charged"
                ? "Send to payments team"
                : resolution === "credit"
                  ? `Add ${formatRs(amount)} to my credit`
                  : `Refund ${formatRs(amount)}`}
        </Button>
      </div>
    </form>
  );
}

export function OrderHelpPage() {
  const { id = "" } = useParams();
  const { data: order, error } = useOrder(id);
  useDocumentTitle(order ? `Help with order ${order.id}` : "Help with an order");
  const status = order ? orderStatus(order) : undefined;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          {error ? (
            <EmptyState
              title="We can't find this order"
              description="It may have been placed on another device. Pick it from your recent orders instead."
              action={<Button href="/help">See recent orders</Button>}
            />
          ) : !order || !status ? null : order.issue ? (
            <Resolved order={order} />
          ) : status === "cancelled" ? (
            <EmptyState
              title="This order was cancelled"
              description={`${order.payment.type === "card" ? "Nothing was charged to your card." : "There was nothing to pay."} If you see a charge anyway, chat with us and we'll check it.`}
              action={<Button href={`/support?order=${order.id}`}>Chat with support</Button>}
            />
          ) : status !== "delivered" && status !== "collected" ? (
            <EmptyState
              title="This order is still on its way"
              description="You can report a problem once it arrives. If it's running late, follow it live or chat with us now."
              action={
                <div className={styles.doneActions}>
                  <Button href={`/orders/${order.id}`}>Track order</Button>
                  <Button variant="outline" href={`/support?order=${order.id}`}>
                    Chat with support
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <h1 className={styles.title}>Help with an order</h1>
              <div className={styles.order}>
                <img src={imageUrl(order.restaurant.imageId, 120, 120)} alt="" />
                <p>
                  <strong>{order.restaurant.name}</strong>
                  <span>
                    {orderDate(order.placedAt)}, {formatRs(order.totals.total)}
                  </span>
                  <span>{itemsSummary(order, 3)}</span>
                </p>
              </div>
              <HelpFlow order={order} />
            </>
          )}
        </Container>
      </main>
    </>
  );
}
