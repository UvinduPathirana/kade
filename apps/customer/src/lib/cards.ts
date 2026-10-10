import type { CardBrand } from "@/api/types";

/** "Visa ending 4242": how every screen names a saved card. */
export const cardLabel = (c: { brand: string; last4: string }) => `${c.brand} ending ${c.last4}`;

export const digitsOnly = (s: string) => s.replace(/\D/g, "");

/** Groups digits as they're typed: "4242 4242 4242 4242" (Amex 4-6-5). */
export function formatCardNumber(raw: string): string {
  const d = digitsOnly(raw).slice(0, 19);
  const groups = /^3[47]/.test(d) ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const out: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + g));
    i += g;
  }
  return out.join(" ");
}

/** "0828" → "08/28" as people type the expiry. */
export function formatExpiry(raw: string): string {
  const d = digitsOnly(raw).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function cardBrand(number: string): CardBrand | undefined {
  const d = digitsOnly(number);
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  return undefined;
}

/** Luhn checksum: catches most mistyped card numbers before they reach the bank. */
export function passesLuhn(number: string): boolean {
  const d = digitsOnly(number);
  if (d.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export type CardErrors = Partial<Record<"number" | "expiry" | "cvc" | "name", string>>;

/** Same checks on the form and in the payments service, so errors appear before anyone presses Save. */
export function validateCard(
  input: { number: string; expiry: string; cvc: string; name: string },
  today = new Date(),
): CardErrors {
  const errors: CardErrors = {};
  const brand = cardBrand(input.number);
  if (!digitsOnly(input.number)) errors.number = "Enter the long number on the front of the card.";
  else if (!brand || !passesLuhn(input.number))
    errors.number = "This card number isn't valid. Check it against your card and try again.";

  const m = /^(\d{2})\/(\d{2})$/.exec(input.expiry);
  if (!m) errors.expiry = "Enter the expiry date as MM/YY, like 08/28.";
  else {
    const month = Number(m[1]);
    const year = 2000 + Number(m[2]);
    const expired =
      year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth() + 1);
    if (month < 1 || month > 12) errors.expiry = "The month should be between 01 and 12.";
    else if (expired) errors.expiry = "This card has expired. Use a card with a later expiry date.";
  }

  const cvcLength = brand === "Amex" ? 4 : 3;
  if (digitsOnly(input.cvc).length !== cvcLength)
    errors.cvc = `Enter the ${cvcLength}-digit security code from the back of the card.`;
  if (!input.name.trim()) errors.name = "Enter the name as it's printed on the card.";
  return errors;
}
