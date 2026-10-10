import {
  Button,
  Choice,
  ConfirmDialog,
  Container,
  Icon,
  SegmentedControl,
  Sheet,
  formatRs,
  useToast,
  type IconName,
} from "@kade/ui";
import { useState, type FormEvent } from "react";
import { AccountError, PLUS_PRICES, plusActive, plusRenewsAt } from "@/api/account";
import { useCancelPlus, useCards, useJoinPlus, usePlus } from "@/api/queries";
import type { PlusPlan } from "@/api/types";
import { useSession } from "@/features/account/session";
import { PLUS_FREE_DELIVERY_FROM } from "@/features/cart/totals";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { cardLabel } from "@/lib/cards";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./PlusPage.module.css";

const DAY = 86_400_000;
const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-LK", { day: "numeric", month: "long" });

const benefits: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "bike",
    title: "No delivery fee",
    text: `On every order of ${formatRs(PLUS_FREE_DELIVERY_FROM)} or more, from any restaurant or shop.`,
  },
  {
    icon: "cash",
    title: "5% back on pickup",
    text: "Collect it yourself and get 5% of the food back as Kadé credit.",
  },
  {
    icon: "tag",
    title: "Member prices",
    text: "Extra offers from restaurants each week, marked in the app.",
  },
  { icon: "chat", title: "Support that answers first", text: "Your chats go to the front of the queue." },
];

const planOptions = [
  { value: "monthly" as const, label: "Monthly", detail: `${formatRs(PLUS_PRICES.monthly)} a month` },
  {
    value: "yearly" as const,
    label: "Yearly",
    detail: `${formatRs(PLUS_PRICES.yearly)} a year, 2 months free`,
  },
];

function JoinSheet({ plan, onClose }: { plan: PlusPlan; onClose: () => void }) {
  const toast = useToast();
  const { data: cards = [] } = useCards();
  const join = useJoinPlus();
  const [cardId, setCardId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const chosen = cardId ?? cards[0]?.id;
  // Shown from the client's clock; the subscriptions service sets the real date
  const [trialEnd] = useState(() => Date.now() + 30 * DAY);
  const price =
    plan === "monthly"
      ? `${formatRs(PLUS_PRICES.monthly)} a month`
      : `${formatRs(PLUS_PRICES.yearly)} a year`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return setError("Add a card in your account first. Nothing is charged today.");
    try {
      await join.mutateAsync({ plan, cardId: chosen });
      toast({
        title: "Kadé Plus started",
        description: "Free delivery applies from your next order.",
        tone: "success",
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof AccountError ? err.message : "That didn't work. Check your connection and try again.",
      );
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Start your free month"
      onSubmit={submit}
      footer={
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={join.isPending}
          trailing="Rs 0 today"
        >
          {join.isPending ? "Starting…" : "Start free month"}
        </Button>
      }
    >
      <p className={styles.sheetText}>
        Nothing is charged today. From {longDate(trialEnd)} it's {price}. Cancel before then and you won't pay
        anything.
      </p>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Card for when the free month ends</legend>
        {cards.map((c) => (
          <Choice
            key={c.id}
            type="radio"
            name="plus-card"
            checked={chosen === c.id}
            onChange={() => setCardId(c.id)}
            label={cardLabel(c)}
          />
        ))}
      </fieldset>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

export function PlusPage() {
  useDocumentTitle("Kadé Plus");
  const toast = useToast();
  const user = useSession((s) => s.user);
  const { data: membership } = usePlus();
  const cancel = useCancelPlus();
  const [plan, setPlan] = useState<PlusPlan>("monthly");
  const [joining, setJoining] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const active = plusActive(membership);
  const member = membership?.status === "member";
  const cancelled = membership?.status === "cancelled" && active;
  const next = membership && member ? plusRenewsAt(membership) : undefined;
  const inTrial = !!membership?.trialEndsAt && next === membership.trialEndsAt;

  const join = user ? (
    <Button variant="ink" size="lg" onClick={() => setJoining(true)} aria-haspopup="dialog">
      {cancelled ? "Rejoin Kadé Plus" : "Start your free month"}
    </Button>
  ) : (
    <Button variant="ink" size="lg" href="/signin?next=/plus">
      Sign in to start your free month
    </Button>
  );

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <section className={styles.hero} aria-labelledby="plus-title">
            <div className={styles.copy}>
              <h1 id="plus-title" className={styles.title}>
                {member
                  ? "You're on Kadé Plus."
                  : cancelled
                    ? `Plus ends on ${longDate(membership!.endsAt!)}.`
                    : `No delivery fee on orders over ${formatRs(PLUS_FREE_DELIVERY_FROM)}.`}
              </h1>
              <p className={styles.lead}>
                {member && membership
                  ? inTrial
                    ? `Your free month ends on ${longDate(next!)}. Then ${formatRs(PLUS_PRICES[membership.plan ?? "monthly"])} a ${membership.plan === "yearly" ? "year" : "month"} on ${membership.cardLabel}.`
                    : `Next payment ${longDate(next!)}: ${formatRs(PLUS_PRICES[membership.plan ?? "monthly"])} on ${membership.cardLabel}.`
                  : cancelled
                    ? "You keep free delivery until then, and you won't be charged again."
                    : "Kadé Plus is a membership for people who order more than once a week. The first month is free."}
              </p>
            </div>

            {/* The membership card: the page's one turmeric surface */}
            <div className={styles.card}>
              <p className={styles.cardName}>kadé plus</p>
              <div className={styles.cardBody}>
                {member || cancelled ? (
                  <>
                    <p className={styles.cardHolder}>{user?.name ?? "Member"}</p>
                    <p>
                      {member
                        ? inTrial
                          ? "Free month"
                          : membership?.plan === "yearly"
                            ? "Yearly member"
                            : "Monthly member"
                        : `Until ${longDate(membership!.endsAt!)}`}
                    </p>
                  </>
                ) : (
                  <>
                    <SegmentedControl
                      variant="card"
                      label="Plan"
                      options={planOptions}
                      value={plan}
                      onChange={setPlan}
                      onColor
                      className={styles.plans}
                    />
                    <p className={styles.cardNote}>First month free on either plan. Cancel any time.</p>
                  </>
                )}
              </div>
              <div className={styles.cardAction}>
                {member ? (
                  <Button variant="outline" onClick={() => setConfirmCancel(true)} className={styles.cancel}>
                    Cancel membership
                  </Button>
                ) : (
                  join
                )}
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="benefits-title">
            <h2 id="benefits-title" className={styles.heading}>
              What you get
            </h2>
            <ul className={styles.benefits}>
              {benefits.map((b) => (
                <li key={b.title}>
                  <Icon name={b.icon} />
                  <h3>{b.title}</h3>
                  <p>{b.text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="faq-title">
            <h2 id="faq-title" className={styles.heading}>
              Questions
            </h2>
            <div className={styles.faq}>
              <details>
                <summary>When am I charged?</summary>
                <p>
                  Thirty days after you join, then every month or year from that date. The date is always on
                  this page.
                </p>
              </details>
              <details>
                <summary>Does it work on every order?</summary>
                <p>
                  Free delivery applies to any restaurant or shop on Kadé when the food comes to{" "}
                  {formatRs(PLUS_FREE_DELIVERY_FROM)} or more before fees. Pickup orders get 5% back instead.
                </p>
              </details>
              <details>
                <summary>What happens if I cancel?</summary>
                <p>
                  You keep the benefits until the end of the time you've paid for, then it stops. No fee for
                  cancelling.
                </p>
              </details>
            </div>
          </section>
        </Container>
      </main>

      {joining && <JoinSheet plan={plan} onClose={() => setJoining(false)} />}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel Kadé Plus?"
        description={`You keep free delivery until ${next ? longDate(next) : "the end of this period"}. After that you won't be charged.`}
        cancelLabel="Keep Plus"
        confirmLabel="Cancel membership"
        onConfirm={() =>
          cancel.mutate(undefined, {
            onSuccess: (m) =>
              toast({ title: "Membership cancelled", description: `Plus ends on ${longDate(m.endsAt!)}.` }),
          })
        }
      />
      <SiteFooter />
      <TabBar />
    </>
  );
}
