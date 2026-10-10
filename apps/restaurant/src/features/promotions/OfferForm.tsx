import {
  Button,
  Choice,
  ChoiceGroup,
  SegmentedControl,
  Select,
  TextField,
  formatRs,
  useToast,
} from "@kade/ui";
import { useState, type FormEvent } from "react";
import { addDays } from "@/api/payouts";
import { todayIso } from "@/api/promotions";
import { useCreateOffer } from "@/api/queries";
import type { Menu, OfferInput, OfferType } from "@/api/types";
import { offerTypeLabels } from "./offerText";
import { OfferPreview } from "./OfferPreview";
import styles from "./OfferForm.module.css";

const num = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

/** Create an offer, with the customer's view updating beside the form as you type. */
export function OfferForm({ menu, onDone }: { menu?: Menu; onDone: (created?: OfferInput) => void }) {
  const toast = useToast();
  const create = useCreateOffer();
  const today = todayIso();
  const [type, setType] = useState<OfferType>("percent");
  const [value, setValue] = useState("20");
  const [maxDiscount, setMaxDiscount] = useState("500");
  const [minOrder, setMinOrder] = useState("");
  const [buy, setBuy] = useState("2");
  const [get, setGet] = useState("1");
  const items = menu?.sections.flatMap((s) => s.items) ?? [];
  const [chosenBogoId, setBogoItemId] = useState("");
  const bogoItemId = chosenBogoId || items[0]?.id || "";
  const [wholeMenu, setWholeMenu] = useState(true);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 13));
  const [budget, setBudget] = useState("25000");
  const [submitted, setSubmitted] = useState(false);

  const offer: OfferInput = {
    type,
    value: num(value),
    maxDiscount: type === "percent" ? num(maxDiscount) : 0,
    minOrder: num(minOrder),
    buy: num(buy),
    get: num(get),
    bogoItemId: type === "bogo" ? bogoItemId : undefined,
    sectionIds: (type === "percent" || type === "amount") && !wholeMenu ? sectionIds : [],
    startDate,
    endDate,
    budget: num(budget),
  };

  const errors: Partial<Record<string, string>> = {};
  if (type === "percent" && !(offer.value >= 5 && offer.value <= 60))
    errors.value = "Choose between 5% and 60%.";
  if (type === "amount" && !(offer.value > 0)) errors.value = "Enter how many rupees off.";
  if (type === "amount" && offer.minOrder <= offer.value)
    errors.minOrder = "The minimum order has to be more than the discount.";
  if (type === "bogo" && !(offer.buy >= 1 && offer.get >= 1))
    errors.bogo = "Enter how many they buy and get.";
  if (!wholeMenu && (type === "percent" || type === "amount") && !sectionIds.length)
    errors.sections = "Choose at least one section, or the whole menu.";
  if (!startDate || startDate < today) errors.startDate = "Start today or later.";
  if (!endDate || endDate < startDate) errors.endDate = "End on or after the start date.";
  if (offer.budget < 1000) errors.budget = "Set a budget of at least Rs 1,000.";
  const show = (key: string) => (submitted ? errors[key] : undefined);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    create.mutate(offer, {
      onSuccess: () => {
        toast({
          title: "Offer created",
          description:
            startDate === today ? "It's live for customers now." : "It starts on the date you set.",
          tone: "success",
        });
        onDone(offer);
      },
      onError: (err) => toast({ title: "Offer not created", description: err.message, tone: "error" }),
    });
  };

  return (
    <div className={styles.layout}>
      <form className={styles.form} onSubmit={onSubmit} noValidate aria-labelledby="create-offer-title">
        <h2 id="create-offer-title" className={styles.title}>
          Create an offer
        </h2>

        <div className={styles.field}>
          <p className={styles.label}>Type of offer</p>
          <SegmentedControl
            label="Type of offer"
            variant="card"
            value={type}
            onChange={setType}
            className={styles.types}
            options={(Object.keys(offerTypeLabels) as OfferType[]).map((t) => ({
              value: t,
              label: offerTypeLabels[t],
              detail:
                t === "percent"
                  ? "20% off kottu"
                  : t === "amount"
                    ? "Rs 300 off over Rs 2,500"
                    : t === "bogo"
                      ? "Buy 2 faluda, get 1 free"
                      : "No delivery fee",
            }))}
          />
        </div>

        {type === "percent" && (
          <div className={styles.row}>
            <TextField
              label="Percent off"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              error={show("value")}
              hint="Between 5 and 60"
            />
            <TextField
              label="Most off one order"
              prefix="Rs"
              inputMode="numeric"
              value={maxDiscount}
              onChange={(e) => setMaxDiscount(e.target.value)}
              hint="Leave empty for no limit"
            />
          </div>
        )}
        {type === "amount" && (
          <div className={styles.row}>
            <TextField
              label="Rupees off"
              prefix="Rs"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              error={show("value")}
            />
            <TextField
              label="On orders over"
              prefix="Rs"
              inputMode="numeric"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              error={show("minOrder")}
            />
          </div>
        )}
        {type === "bogo" && (
          <div className={styles.row}>
            <Select
              label="Dish"
              value={bogoItemId}
              onChange={(e) => setBogoItemId(e.target.value)}
              options={items.map((i) => ({ value: i.id, label: `${i.name}, ${formatRs(i.price)}` }))}
            />
            <TextField
              label="They buy"
              inputMode="numeric"
              value={buy}
              onChange={(e) => setBuy(e.target.value)}
              error={show("bogo")}
            />
            <TextField
              label="They get free"
              inputMode="numeric"
              value={get}
              onChange={(e) => setGet(e.target.value)}
            />
          </div>
        )}
        {type === "freeDelivery" && (
          <div className={styles.row}>
            <TextField
              label="On orders over"
              prefix="Rs"
              inputMode="numeric"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              hint="Leave empty for every order. You pay the Rs 150 delivery fee."
            />
          </div>
        )}

        {(type === "percent" || type === "amount") && (
          <ChoiceGroup
            legend="Which dishes"
            hint="Required"
            required
            complete={wholeMenu || sectionIds.length > 0}
            error={show("sections")}
          >
            <Choice
              type="radio"
              name="scope"
              label="Whole menu"
              checked={wholeMenu}
              onChange={() => setWholeMenu(true)}
            />
            <Choice
              type="radio"
              name="scope"
              label="Some sections"
              checked={!wholeMenu}
              onChange={() => setWholeMenu(false)}
            />
            {!wholeMenu &&
              menu?.sections.map((s) => (
                <Choice
                  key={s.id}
                  type="checkbox"
                  className={styles.indent}
                  label={s.name}
                  meta={`${s.items.length} dishes`}
                  checked={sectionIds.includes(s.id)}
                  onChange={(e) =>
                    setSectionIds((ids) =>
                      e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id),
                    )
                  }
                />
              ))}
          </ChoiceGroup>
        )}

        <div className={styles.row}>
          <TextField
            type="date"
            label="Starts"
            min={today}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            error={show("startDate")}
          />
          <TextField
            type="date"
            label="Ends"
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            error={show("endDate")}
          />
        </div>

        <TextField
          label="Budget"
          prefix="Rs"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          error={show("budget")}
          hint="You fund the discount: it comes off your weekly payout. The offer stops when the budget is used."
        />

        <div className={styles.actions}>
          <Button type="submit" size="lg" disabled={create.isPending}>
            Create offer
          </Button>
          <Button variant="secondary" size="lg" onClick={() => onDone()}>
            Cancel
          </Button>
        </div>
      </form>

      <div className={styles.previewCol}>
        <OfferPreview offer={offer} menu={menu} />
      </div>
    </div>
  );
}
