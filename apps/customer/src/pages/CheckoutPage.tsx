import {
  Button,
  Choice,
  Container,
  EmptyState,
  Icon,
  Panel,
  SegmentedControl,
  Tag,
  TextArea,
  TextField,
  formatRs,
} from "@kade/ui";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { OrderError, savedAddresses, savedCard } from "@/api/orders";
import { validatePromo } from "@/api/promos";
import { usePlaceOrder, useRestaurant } from "@/api/queries";
import type { PaymentMethod } from "@/api/types";
import { cashNotes, timeSlots } from "@/features/checkout/timeSlots";
import { OrderSummary } from "@/features/checkout/OrderSummary";
import { useCart } from "@/features/cart/store";
import { computeTotals } from "@/features/cart/totals";
import { SiteHeader } from "@/layout/SiteHeader";
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
  const { restaurant: cartRestaurant, lines, mode, setMode, clear } = useCart();
  const { data: restaurant } = useRestaurant(cartRestaurant?.id ?? 0);
  const placeOrder = usePlaceOrder();

  const isClosed = !!restaurant?.closedLabel;
  const slots = useMemo(() => timeSlots(), []);

  const [addressId, setAddressId] = useState(savedAddresses[0]!.id);
  const [riderNote, setRiderNote] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [slot, setSlot] = useState(slots[0]?.value ?? 0);
  const [payType, setPayType] = useState<"card" | "cash">("card");
  const [payingWith, setPayingWith] = useState<number | undefined>(undefined);
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
  const totals = computeTotals(lines, cartRestaurant, mode, {
    promoDiscount: promo?.ok ? promo.discount : 0,
    tip,
  });

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
    const payment: PaymentMethod = payType === "card" ? savedCard : { type: "cash", payingWith };
    try {
      const order = await placeOrder.mutateAsync({
        mode,
        restaurant: {
          ...cartRestaurant,
          area: restaurant?.area ?? "",
        },
        lines,
        address: mode === "delivery" ? savedAddresses.find((a) => a.id === addressId) : undefined,
        riderNote: riderNote.trim(),
        scheduledFor: scheduling ? slot : undefined,
        payment,
        promoCode: promo?.ok ? promo.code : undefined,
        tip,
      });
      clear();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
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
                <Panel title="Deliver to" titleId="co-address">
                  <fieldset className={styles.fieldset}>
                    <legend className="kd-visually-hidden">Delivery address</legend>
                    {savedAddresses.map((a) => (
                      <Choice
                        key={a.id}
                        type="radio"
                        name="address"
                        label={
                          <span className={styles.choiceText}>
                            <strong>{a.label}</strong>
                            <span>{a.line}</span>
                          </span>
                        }
                        checked={addressId === a.id}
                        onChange={() => setAddressId(a.id)}
                      />
                    ))}
                  </fieldset>
                  <TextArea
                    label="Note for the rider"
                    maxLength={160}
                    placeholder="For example: blue gate, second floor, call when you reach Galle Rd"
                    value={riderNote}
                    onChange={(e) => setRiderNote(e.target.value)}
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
                  <Choice
                    type="radio"
                    name="pay"
                    label={
                      <span className={styles.payRow}>
                        <Icon name="card" />
                        <span className={styles.choiceText}>
                          <strong>
                            {savedCard.brand} ending {savedCard.last4}
                          </strong>
                          <span>Charged when the restaurant accepts</span>
                        </span>
                      </span>
                    }
                    checked={payType === "card"}
                    onChange={() => setPayType("card")}
                  />
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
                    onChange={() => setPayType("cash")}
                  />
                </fieldset>
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
                <OrderSummary
                  lines={lines}
                  totals={totals}
                  discountPercent={cartRestaurant.discountPercent}
                  promoCode={promo?.ok ? promo.code : undefined}
                  delivery={mode === "delivery"}
                />
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
