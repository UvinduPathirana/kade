import {
  Button,
  Choice,
  Container,
  EmptyState,
  Icon,
  Panel,
  SegmentedControl,
  Switch,
  Tag,
  TextArea,
  TextField,
  formatRs,
} from "@kade/ui";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { DECLINING_LAST4, plusActive } from "@/api/account";
import { OrderError, PaymentDeclinedError } from "@/api/orders";
import { validatePromo } from "@/api/promos";
import { useCards, useCredit, usePlaceOrder, usePlus, useRestaurant } from "@/api/queries";
import type { PaymentMethod } from "@/api/types";
import { useAddress } from "@/features/address/store";
import { cashNotes, timeSlots } from "@/features/checkout/timeSlots";
import { OrderSummary } from "@/features/checkout/OrderSummary";
import { useCart } from "@/features/cart/store";
import { computeTotals } from "@/features/cart/totals";
import { substitutionOptions, useSubstitution } from "@/features/shop/substitution";
import { SiteHeader } from "@/layout/SiteHeader";
import { cardLabel } from "@/lib/cards";
import { pickupMinutes } from "@/lib/eta";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./CheckoutPage.module.css";

const tipOptions = [
  { value: "0", label: "No tip" },
  { value: "100", label: "Rs 100" },
  { value: "200", label: "Rs 200" },
  { value: "300", label: "Rs 300" },
  { value: "other", label: "Other" },
];

export function CheckoutPage() {
  useDocumentTitle("Checkout");
  const navigate = useNavigate();
  const { restaurant: cartRestaurant, lines, mode, setMode, clear, groupId } = useCart();
  const { data: restaurant } = useRestaurant(cartRestaurant?.id ?? 0);
  const { data: cards = [] } = useCards();
  const { data: credit } = useCredit();
  const { data: plus } = usePlus();
  const address = useAddress((s) => s.current);
  const openAddressPicker = useAddress((s) => s.setPickerOpen);
  const substitution = useSubstitution((s) => s.value);
  const setSubstitution = useSubstitution((s) => s.set);
  const placeOrder = usePlaceOrder();
  const errorRef = useRef<HTMLDivElement>(null);

  const isClosed = !!restaurant?.closedLabel;
  const isShop = restaurant?.categoryId === "grocery";
  const slots = useMemo(() => timeSlots(), []);

  /** null until edited, so the saved address's standing note shows by default. */
  const [riderNoteEdit, setRiderNoteEdit] = useState<string | null>(null);
  const riderNote = riderNoteEdit ?? address.note ?? "";
  const [when, setWhen] = useState<"now" | "later">("now");
  const [slot, setSlot] = useState(slots[0]?.value ?? 0);
  /** A saved card's id, or "cash". */
  const [payChoice, setPayChoice] = useState("visa-4242");
  const [payingWith, setPayingWith] = useState<number | undefined>(undefined);
  const [applyCredit, setApplyCredit] = useState(true);
  const [declined, setDeclined] = useState<string | undefined>();
  const [tipChoice, setTipChoice] = useState("100");
  const [customTip, setCustomTip] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState<string | undefined>();
  const [promoError, setPromoError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | undefined>();

  const scheduling = when === "later" || isClosed;
  const tip =
    mode === "delivery"
      ? tipChoice === "other"
        ? Math.max(0, Math.round(Number(customTip) || 0))
        : Number(tipChoice)
      : 0;

  // Re-check an applied code whenever the order changes, e.g. a dish removed below the minimum
  const base = computeTotals(lines, cartRestaurant, mode);
  const promo =
    promoCode && cartRestaurant ? validatePromo(promoCode, base.subtotal, cartRestaurant.id) : undefined;
  const creditBalance = credit?.balance ?? 0;
  const totals = computeTotals(lines, cartRestaurant, mode, {
    promoDiscount: promo?.ok ? promo.discount : 0,
    tip,
    credit: applyCredit ? creditBalance : 0,
    plus: plusActive(plus),
  });

  const payType = payChoice === "cash" ? "cash" : "card";
  const card = cards.find((c) => c.id === payChoice) ?? cards[0];
  // After a decline, offer the first card that isn't the one the bank refused
  const fallbackCard = cards.find((c) => c.last4 !== DECLINING_LAST4 && c.id !== card?.id);
  const choosePayment = (id: string) => {
    setPayChoice(id);
    setDeclined(undefined);
    setSubmitError(undefined);
  };

  if (!cartRestaurant || !lines.length) {
    return (
      <>
        <SiteHeader minimal />
        <Container className={styles.empty}>
          <h1 className={styles.title}>Checkout</h1>
          <EmptyState
            title="Nothing to check out yet"
            description="Your cart is empty. Add a dish from a restaurant, then come back here to pay."
            action={<Button href="/">Browse restaurants</Button>}
          />
        </Container>
      </>
    );
  }

  const applyPromo = () => {
    const result = validatePromo(promoInput, base.subtotal, cartRestaurant.id);
    if (result.ok) {
      setPromoCode(result.code);
      setPromoError(undefined);
      setPromoInput("");
    } else setPromoError(result.error);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(undefined);
    if (promo && !promo.ok) {
      setSubmitError(`${promo.error} Remove the code to place your order without it.`);
      return;
    }
    setDeclined(undefined);
    if (payType === "card" && !card) {
      setSubmitError("Add a card in your account, or choose cash.");
      return;
    }
    const payment: PaymentMethod =
      payType === "card" && card
        ? { type: "card", brand: card.brand, last4: card.last4 }
        : { type: "cash", payingWith };
    try {
      const order = await placeOrder.mutateAsync({
        mode,
        restaurant: {
          ...cartRestaurant,
          area: restaurant?.area ?? "",
        },
        lines,
        address: mode === "delivery" ? address : undefined,
        riderNote: riderNote.trim(),
        scheduledFor: scheduling ? slot : undefined,
        payment,
        promoCode: promo?.ok ? promo.code : undefined,
        tip,
        useCredit: applyCredit && creditBalance > 0,
        substitution: isShop ? substitution : undefined,
        groupId,
      });
      clear();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      if (err instanceof PaymentDeclinedError) {
        setDeclined(err.message);
        // Move focus to the explanation so keyboard and screen reader users land on the way out
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      setSubmitError(
        err instanceof OrderError
          ? err.message
          : "Your order didn't go through. Check your connection and try again. You haven't been charged.",
      );
    }
  };

  const etaNow =
    mode === "delivery"
      ? `${cartRestaurant.eta[0]}–${cartRestaurant.eta[1]} min`
      : `Ready in ${pickupMinutes(cartRestaurant.eta)} min`;

  return (
    <>
      <SiteHeader minimal />
      <main id="main">
        <Container className={styles.page}>
          <h1 className={styles.title}>Checkout</h1>
          <form className={styles.layout} onSubmit={submit} noValidate>
            <div className={styles.steps}>
              <Panel title="How you'll get it" titleId="co-mode">
                <SegmentedControl
                  variant="card"
                  label="Order type"
                  value={mode}
                  onChange={setMode}
                  className={styles.mode}
                  options={[
                    {
                      value: "delivery",
                      label: "Delivery",
                      detail: `${cartRestaurant.eta[0]}–${cartRestaurant.eta[1]} min`,
                    },
                    {
                      value: "pickup",
                      label: "Pickup",
                      detail: `Ready in ${pickupMinutes(cartRestaurant.eta)} min`,
                    },
                  ]}
                />
              </Panel>

              {mode === "delivery" ? (
                <Panel
                  title="Deliver to"
                  titleId="co-address"
                  action={
                    <Button variant="secondary" size="sm" onClick={() => openAddressPicker(true)}>
                      Change
                    </Button>
                  }
                >
                  <p className={styles.pickup}>
                    <Icon name="pin" />
                    <span>
                      <strong>{address.label}</strong>
                      <span>{address.line}</span>
                    </span>
                  </p>
                  <TextArea
                    label="Note for the rider"
                    maxLength={160}
                    placeholder="For example: blue gate, second floor, call when you reach Galle Rd"
                    value={riderNote}
                    onChange={(e) => setRiderNoteEdit(e.target.value)}
                  />
                </Panel>
              ) : (
                <Panel title="Pick up from" titleId="co-pickup">
                  <p className={styles.pickup}>
                    <Icon name="store" />
                    <span>
                      <strong>{cartRestaurant.name}</strong>
                      <span>214 Galle Rd, {restaurant?.area}, Colombo</span>
                    </span>
                  </p>
                </Panel>
              )}

              <Panel title="When" titleId="co-when">
                <fieldset className={styles.fieldset}>
                  <legend className="kd-visually-hidden">When</legend>
                  <Choice
                    type="radio"
                    name="when"
                    label={
                      <span className={styles.choiceText}>
                        <strong>Now</strong>
                        <span>{isClosed ? `Closed now. ${restaurant?.closedLabel}.` : etaNow}</span>
                      </span>
                    }
                    checked={!scheduling}
                    disabled={isClosed}
                    onChange={() => setWhen("now")}
                  />
                  <Choice
                    type="radio"
                    name="when"
                    label={
                      <span className={styles.choiceText}>
                        <strong>Schedule for later</strong>
                        <span>
                          {mode === "delivery" ? "Choose when it arrives" : "Choose when to collect"}
                        </span>
                      </span>
                    }
                    checked={scheduling}
                    onChange={() => setWhen("later")}
                  />
                </fieldset>
                {scheduling && (
                  <label className={styles.select}>
                    <span className="kd-visually-hidden">Time</span>
                    <Icon name="calendar" />
                    <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                      {slots.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevronDown" size={16} />
                  </label>
                )}
              </Panel>

              <Panel title="Payment" titleId="co-pay">
                <fieldset className={styles.fieldset}>
                  <legend className="kd-visually-hidden">Payment method</legend>
                  {cards.map((c) => (
                    <Choice
                      key={c.id}
                      type="radio"
                      name="pay"
                      label={
                        <span className={styles.payRow}>
                          <Icon name="card" />
                          <span className={styles.choiceText}>
                            <strong>{cardLabel(c)}</strong>
                            <span>
                              {declined && c.id === card?.id
                                ? "Declined by your bank just now"
                                : "Charged when the restaurant accepts"}
                            </span>
                          </span>
                        </span>
                      }
                      checked={payType === "card" && card?.id === c.id}
                      onChange={() => choosePayment(c.id)}
                    />
                  ))}
                  <Choice
                    type="radio"
                    name="pay"
                    label={
                      <span className={styles.payRow}>
                        <Icon name="cash" />
                        <span className={styles.choiceText}>
                          <strong>{mode === "delivery" ? "Cash on delivery" : "Pay at the counter"}</strong>
                          <span>
                            {mode === "delivery"
                              ? "Pay the rider when your food arrives"
                              : "Cash or card when you collect"}
                          </span>
                        </span>
                      </span>
                    }
                    checked={payType === "cash"}
                    onChange={() => choosePayment("cash")}
                  />
                </fieldset>
                {creditBalance > 0 && (
                  <Switch
                    className={styles.credit}
                    checked={applyCredit}
                    onChange={setApplyCredit}
                    label="Use Kadé credit"
                    description={`${formatRs(creditBalance)} available${
                      applyCredit && totals.credit
                        ? `, ${formatRs(totals.credit ?? 0)} used on this order`
                        : ""
                    }`}
                  />
                )}
                {payType === "cash" && mode === "delivery" && (
                  <div className={styles.cash}>
                    <p>
                      Have <strong>{formatRs(totals.total)}</strong> ready. Paying with a larger note? Choose
                      it so your rider brings change.
                    </p>
                    <div className={styles.chips}>
                      <SegmentedControl
                        label="I'll pay with"
                        value={payingWith ? String(payingWith) : "exact"}
                        onChange={(v) => setPayingWith(v === "exact" ? undefined : Number(v))}
                        options={[
                          { value: "exact", label: "Exact amount" },
                          ...cashNotes(totals.total).map((n) => ({ value: String(n), label: formatRs(n) })),
                        ]}
                      />
                    </div>
                  </div>
                )}
              </Panel>

              {isShop && (
                <Panel title="If something's out of stock" titleId="co-subs">
                  <SegmentedControl
                    variant="card"
                    label="If something's out of stock"
                    value={substitution}
                    onChange={setSubstitution}
                    options={substitutionOptions}
                    className={styles.mode}
                  />
                </Panel>
              )}

              {mode === "delivery" && (
                <Panel title="Tip your rider" titleId="co-tip">
                  <SegmentedControl
                    label="Tip"
                    value={tipChoice}
                    onChange={setTipChoice}
                    options={tipOptions}
                    className={styles.tips}
                  />
                  {tipChoice === "other" && (
                    <TextField
                      className={styles.customTip}
                      label="Tip amount"
                      prefix="Rs"
                      inputMode="numeric"
                      value={customTip}
                      onChange={(e) => setCustomTip(e.target.value.replace(/\D/g, ""))}
                      placeholder="150"
                    />
                  )}
                  <p className={styles.hint}>
                    The whole tip goes to your rider. You can change it after delivery.
                  </p>
                </Panel>
              )}

              <Panel title="Promo code" titleId="co-promo">
                {promoCode ? (
                  <div className={styles.applied}>
                    <Tag tone={promo?.ok ? "positive" : "offerSoft"} icon="tag" size="md">
                      {promo?.ok ? `${promoCode}: ${promo.label}` : `${promoCode} no longer applies`}
                    </Tag>
                    <Button variant="secondary" size="sm" onClick={() => setPromoCode(undefined)}>
                      Remove
                    </Button>
                    {promo && !promo.ok && <p className={styles.promoWarn}>{promo.error}</p>}
                  </div>
                ) : (
                  <TextField
                    label="Promo code"
                    hideLabel
                    placeholder="Enter a code, like KADE100"
                    value={promoInput}
                    autoCapitalize="characters"
                    onChange={(e) => {
                      setPromoInput(e.target.value);
                      setPromoError(undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyPromo();
                      }
                    }}
                    error={promoError}
                    action={
                      <Button variant="secondary" size="sm" onClick={applyPromo}>
                        Apply
                      </Button>
                    }
                  />
                )}
              </Panel>
            </div>

            <aside className={styles.summary} aria-labelledby="co-summary">
              <Panel title={cartRestaurant.name} titleId="co-summary">
                {groupId && (
                  <p className={styles.group}>
                    <Icon name="users" />
                    Group order: each person's dishes are bagged with their name on.
                  </p>
                )}
                <OrderSummary
                  lines={lines}
                  totals={totals}
                  discountPercent={cartRestaurant.discountPercent}
                  promoCode={promo?.ok ? promo.code : undefined}
                  delivery={mode === "delivery"}
                />
                {declined && (
                  <div ref={errorRef} tabIndex={-1} className={styles.declined} role="alert">
                    <strong>Payment didn't go through</strong>
                    <p>{declined}</p>
                    <div className={styles.recover}>
                      {fallbackCard && (
                        <Button size="sm" onClick={() => choosePayment(fallbackCard.id)}>
                          Pay with {cardLabel(fallbackCard)}
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => choosePayment("cash")}>
                        {mode === "delivery" ? "Pay cash on delivery" : "Pay at the counter"}
                      </Button>
                    </div>
                  </div>
                )}
                {submitError && (
                  <p className={styles.error} role="alert">
                    {submitError}
                  </p>
                )}
                <div className={styles.place}>
                  <Button
                    type="submit"
                    variant="turmeric"
                    size="lg"
                    fullWidth
                    disabled={placeOrder.isPending}
                    trailing={formatRs(totals.total)}
                  >
                    {placeOrder.isPending ? "Placing order…" : scheduling ? "Schedule order" : "Place order"}
                  </Button>
                </div>
                <p className={styles.legal}>
                  By placing this order you agree to Kadé's terms and privacy policy.
                </p>
              </Panel>
            </aside>
          </form>
        </Container>
      </main>
    </>
  );
}
