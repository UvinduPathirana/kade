import {
  Button,
  Chip,
  Container,
  SegmentedControl,
  Select,
  Tag,
  TextArea,
  TextField,
  formatRs,
  useToast,
} from "@kade/ui";
import { useState, type FormEvent } from "react";
import { AccountError } from "@/api/account";
import { GIFT_MAX, GIFT_MIN, REFERRAL_REWARD, isoDay } from "@/api/gifts";
import { useBuyGiftCard, useCards, useGiftCards, useReferral } from "@/api/queries";
import type { ReferredFriend } from "@/api/types";
import { firstName, useSession } from "@/features/account/session";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { cardLabel } from "@/lib/cards";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useHashScroll } from "@/lib/useHashScroll";
import styles from "./GiftsPage.module.css";

const amounts = [1000, 2500, 5000, 10000];
const MESSAGE_MAX = 200;
const DAY = 86_400_000;

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-LK", { weekday: "long", day: "numeric", month: "long" });

type Errors = Partial<Record<"amount" | "to" | "contact" | "date", string>>;

function GiftCardForm() {
  const toast = useToast();
  const user = useSession((s) => s.user);
  const { data: cards = [] } = useCards();
  const { data: sent = [] } = useGiftCards();
  const buy = useBuyGiftCard();
  const [today] = useState(() => isoDay(Date.now()));
  const [tomorrow] = useState(() => isoDay(Date.now() + DAY));

  const [amount, setAmount] = useState<number | "other">(2500);
  const [other, setOther] = useState("");
  const [to, setTo] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState<"today" | "tomorrow" | "pick">("today");
  const [date, setDate] = useState("");
  const [cardId, setCardId] = useState<string | undefined>();
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | undefined>();

  const value = amount === "other" ? Number(other) || 0 : amount;
  const sendOn = when === "today" ? today : when === "tomorrow" ? tomorrow : date;
  const chosenCard = cardId ?? cards[0]?.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (value < GIFT_MIN || value > GIFT_MAX)
      found.amount = `Choose an amount from ${formatRs(GIFT_MIN)} to ${formatRs(GIFT_MAX)}.`;
    if (!to.trim()) found.to = "Add the name of the person it's for.";
    if (
      !/^(\+?94|0)?7\d{8}$/.test(contact.replace(/[\s-]/g, "")) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim())
    )
      found.contact = "Enter a Sri Lankan mobile number, like 077 123 4567, or an email address.";
    if (!sendOn || sendOn < today) found.date = "Choose today or a date in the future.";
    setErrors(found);
    setServerError(undefined);
    if (Object.keys(found).length || !chosenCard) return;
    try {
      const gift = await buy.mutateAsync({ amount: value, to, contact, message, sendOn, cardId: chosenCard });
      toast({
        title: "Gift card bought",
        description: `${gift.to} gets it ${gift.sendOn === today ? "in the next few minutes" : `on ${dayLabel(gift.sendOn)}`}.`,
        tone: "success",
      });
      setTo("");
      setContact("");
      setMessage("");
    } catch (err) {
      setServerError(err instanceof AccountError ? err.message : "The gift card wasn't bought. Try again.");
    }
  };

  return (
    <section className={styles.gift} aria-labelledby="gift-title">
      <form className={styles.form} onSubmit={submit} noValidate>
        <h2 id="gift-title" className={styles.heading}>
          Send a gift card
        </h2>
        <p className={styles.muted}>They spend it on any restaurant or shop on Kadé. It never expires.</p>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Amount</legend>
          <div className={styles.chips}>
            {amounts.map((a) => (
              <Chip key={a} pressed={amount === a} onClick={() => setAmount(a)}>
                {formatRs(a)}
              </Chip>
            ))}
            <Chip pressed={amount === "other"} onClick={() => setAmount("other")}>
              Other amount
            </Chip>
          </div>
          {amount === "other" && (
            <TextField
              className={styles.other}
              label="Amount"
              hideLabel
              prefix="Rs"
              inputMode="numeric"
              placeholder="3,000"
              value={other}
              onChange={(e) => setOther(e.target.value.replace(/\D/g, ""))}
              hint={`From ${formatRs(GIFT_MIN)} to ${formatRs(GIFT_MAX)}`}
              error={errors.amount}
            />
          )}
          {amount !== "other" && errors.amount && <p className={styles.error}>{errors.amount}</p>}
        </fieldset>

        <div className={styles.pair}>
          <TextField
            label="Who it's for"
            placeholder="Amaya"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            error={errors.to}
          />
          <TextField
            label="Their mobile or email"
            placeholder="077 123 4567"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            error={errors.contact}
          />
        </div>

        <TextArea
          label="Message"
          maxLength={MESSAGE_MAX}
          placeholder="Happy birthday. Dinner's on me."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={styles.message}
        />
        <p className={styles.count}>
          {message.length} of {MESSAGE_MAX} characters
        </p>

        <div className={styles.when}>
          <p className={styles.legend}>When to send it</p>
          <SegmentedControl
            label="When to send it"
            value={when}
            onChange={setWhen}
            options={[
              { value: "today", label: "Now" },
              { value: "tomorrow", label: "Tomorrow" },
              { value: "pick", label: "Pick a date" },
            ]}
          />
          {when === "pick" && (
            <TextField
              className={styles.date}
              label="Date"
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              error={errors.date}
            />
          )}
        </div>

        {user ? (
          <>
            {cards.length > 0 && (
              <Select
                className={styles.pay}
                label="Pay with"
                value={chosenCard ?? ""}
                onChange={(e) => setCardId(e.target.value)}
                options={cards.map((c) => ({ value: c.id, label: cardLabel(c) }))}
              />
            )}
            {serverError && (
              <p className={styles.serverError} role="alert">
                {serverError}
              </p>
            )}
            <Button type="submit" size="lg" fullWidth disabled={buy.isPending} trailing={formatRs(value)}>
              {buy.isPending ? "Buying…" : "Buy gift card"}
            </Button>
          </>
        ) : (
          <Button href="/signin?next=/gifts" size="lg" fullWidth>
            Sign in to buy a gift card
          </Button>
        )}
      </form>

      <div className={styles.previewCol}>
        {/* Live preview: the page's one turmeric surface */}
        <figure className={styles.card} aria-label="Gift card preview">
          <p className={styles.cardBrand}>kadé</p>
          <p className={styles.cardAmount}>{value ? formatRs(value) : "Rs 0"}</p>
          <figcaption className={styles.cardText}>
            <strong>For {to.trim() || "someone you like"}</strong>
            {message.trim() && <span className={styles.cardMessage}>{message.trim()}</span>}
            <span>From {user ? firstName(user) : "you"}</span>
          </figcaption>
        </figure>
        {sent.length > 0 && (
          <div className={styles.sent}>
            <h3>Gift cards you've sent</h3>
            <ul>
              {sent.map((g) => (
                <li key={g.id}>
                  <span>
                    {formatRs(g.amount)} for {g.to}
                  </span>
                  <span>{g.sendOn === today ? "Sent today" : `Sends ${dayLabel(g.sendOn)}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const friendTag = (f: ReferredFriend) =>
  f.status === "ordered" ? (
    <Tag tone="positive">{formatRs(REFERRAL_REWARD)} added to your credit</Tag>
  ) : f.status === "joined" ? (
    <Tag tone="warning">Signed up, hasn't ordered yet</Tag>
  ) : (
    <Tag tone="neutral">Invite sent</Tag>
  );

function Referral() {
  const toast = useToast();
  const user = useSession((s) => s.user);
  const name = firstName(user);
  const { data: referral } = useReferral(name);
  const reward = formatRs(REFERRAL_REWARD);

  const share = async (code: string) => {
    const text = `Get ${reward} off your first Kadé order over Rs 1,500 with my code ${code}.`;
    try {
      if (navigator.share) await navigator.share({ title: "Kadé", text, url: `${location.origin}/welcome` });
      else {
        await navigator.clipboard.writeText(text);
        toast({ title: "Invite copied", description: "Paste it into a message to a friend." });
      }
    } catch {
      // Share sheet dismissed
    }
  };

  return (
    <section id="refer" className={styles.refer} aria-labelledby="refer-title">
      <div>
        <h2 id="refer-title" className={styles.heading}>
          Invite friends, get {reward} each
        </h2>
        <ol className={styles.how}>
          <li>
            <span aria-hidden="true">1</span>Share your code with a friend who hasn't used Kadé.
          </li>
          <li>
            <span aria-hidden="true">2</span>They get {reward} off their first order over Rs 1,500.
          </li>
          <li>
            <span aria-hidden="true">3</span>Once it's delivered, {reward} lands in your Kadé credit.
          </li>
        </ol>
      </div>

      {user && referral ? (
        <div className={styles.referSide}>
          <div className={styles.code}>
            <span className={styles.codeLabel}>Your code</span>
            <strong>{referral.code}</strong>
            <div className={styles.codeActions}>
              <Button size="sm" icon="share" onClick={() => void share(referral.code)}>
                Share invite
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(referral.code);
                    toast({ title: `${referral.code} copied` });
                  } catch {
                    toast({ title: `Your code is ${referral.code}` });
                  }
                }}
              >
                Copy code
              </Button>
            </div>
          </div>
          <h3 className={styles.friendsTitle}>Friends you've invited</h3>
          <ul className={styles.friends}>
            {referral.friends.map((f) => (
              <li key={f.name}>
                <strong>{f.name}</strong>
                {friendTag(f)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={styles.referSide}>
          <p className={styles.muted}>Sign in to get your own invite code and see who's used it.</p>
          <Button href="/signin?next=/gifts%23refer">Sign in</Button>
        </div>
      )}
    </section>
  );
}

export function GiftsPage() {
  useDocumentTitle("Gift cards and invites");
  useHashScroll();
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <h1 className={styles.title}>Gift cards and invites</h1>
          <GiftCardForm />
          <Referral />
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
