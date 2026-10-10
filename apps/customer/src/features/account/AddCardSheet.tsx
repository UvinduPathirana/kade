import { Button, Sheet, TextField, useToast } from "@kade/ui";
import { useState, type FormEvent } from "react";
import { AccountError } from "@/api/account";
import { useAddCard } from "@/api/queries";
import {
  cardBrand,
  cardLabel,
  formatCardNumber,
  formatExpiry,
  validateCard,
  type CardErrors,
} from "@/lib/cards";
import styles from "./AddCardSheet.module.css";

function CardForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const add = useAddCard();
  const [form, setForm] = useState({ number: "", expiry: "", cvc: "", name: "" });
  const [errors, setErrors] = useState<CardErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const brand = cardBrand(form.number);

  const set = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setServerError(undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateCard(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const card = await add.mutateAsync(form);
      toast({ title: "Card added", description: cardLabel(card), tone: "success" });
      onClose();
    } catch (err) {
      setServerError(
        err instanceof AccountError
          ? err.message
          : "The card wasn't saved. Check your connection and try again.",
      );
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add a card"
      onSubmit={submit}
      footer={
        <Button type="submit" size="lg" fullWidth disabled={add.isPending}>
          {add.isPending ? "Saving card…" : "Save card"}
        </Button>
      }
    >
      <p className={styles.demo}>
        This demo only accepts test cards. Use 4242 4242 4242 4242 with any future date and any 3 digits.
      </p>
      <div className={styles.fields}>
        <TextField
          label="Card number"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          value={form.number}
          onChange={(e) => set("number", formatCardNumber(e.target.value))}
          error={errors.number}
          hint={brand}
        />
        <div className={styles.row}>
          <TextField
            label="Expiry"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            value={form.expiry}
            onChange={(e) => set("expiry", formatExpiry(e.target.value))}
            error={errors.expiry}
          />
          <TextField
            label="Security code"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder={brand === "Amex" ? "4 digits" : "3 digits"}
            maxLength={4}
            value={form.cvc}
            onChange={(e) => set("cvc", e.target.value.replace(/\D/g, ""))}
            error={errors.cvc}
          />
        </div>
        <TextField
          label="Name on card"
          autoComplete="cc-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          error={errors.name}
        />
      </div>
      {serverError && (
        <p className={styles.error} role="alert">
          {serverError}
        </p>
      )}
      <p className={styles.note}>
        Kadé keeps only the brand, last 4 digits and expiry. Your bank checks the rest.
      </p>
    </Sheet>
  );
}

export function AddCardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <CardForm onClose={onClose} /> : null;
}
