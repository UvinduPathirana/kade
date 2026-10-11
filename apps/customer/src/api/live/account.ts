// Account API against the customer gateway (profile, payment and promotion services behind it).
import { cardBrand, digitsOnly, validateCard } from "@/lib/cards";
import { AccountError, ApiError } from "../errors";
import { api, newIdempotencyKey } from "../http";
import type { CreditAccount, NewCardInput, PlusMembership, PlusPlan, SavedCard, User } from "../types";

/** 4xx problems carry copy the app shows as-is. */
export function asAccountError(err: unknown): never {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401)
    throw new AccountError(err.message);
  throw err;
}

export interface Me {
  user: User;
  isNew: boolean;
  plusActive: boolean;
}

/** The signed-in customer; the gateway creates the profile on first sign-in. */
export const getMe = () => api<Me>("GET", "/v1/me", { auth: "required" });

export async function saveProfile(user: User): Promise<User> {
  if (!user.name.trim()) throw new AccountError("Enter your name so riders know who to ask for.");
  if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email))
    throw new AccountError("That email address looks incomplete. Check it has an @ and a domain.");
  const saved = await api<User>("PUT", "/v1/me", {
    auth: "required",
    body: { name: user.name.trim(), email: user.email?.trim() || undefined },
  }).catch(asAccountError);
  // Keep the phone the app knows if the profile doesn't have one yet.
  return { ...saved, phone: saved.phone || user.phone };
}

export const listCards = () => api<SavedCard[]>("GET", "/v1/me/cards", { auth: "required" });

/**
 * Card numbers never reach Kadé: the gateway opens a PSP setup session, the card goes to the PSP's
 * hosted endpoint, and only the PSP's token (plus brand/last4/expiry for display) is saved. With the
 * dev fake PSP (no psp_url) the token is a test token derived in the browser.
 */
export async function addCard(input: NewCardInput): Promise<SavedCard> {
  const errors = validateCard(input);
  const first = Object.values(errors)[0];
  if (first) throw new AccountError(first);
  const number = digitsOnly(input.number);
  const brand = cardBrand(number);
  if (!brand) throw new AccountError("We take Visa, Mastercard and Amex.");
  const session = await api<{ sessionId: string; clientSecret: string; pspUrl: string }>(
    "POST",
    "/v1/me/cards/session",
    { auth: "required" },
  ).catch(asAccountError);
  let pspToken = `tok_test_${brand.toLowerCase()}_${number.slice(-4)}_${Date.now()}`;
  if (session.pspUrl) {
    const res = await fetch(session.pspUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.clientSecret}` },
      body: JSON.stringify({ number, expiry: input.expiry, cvc: input.cvc, name: input.name }),
    });
    if (!res.ok)
      throw new AccountError("Your bank didn't accept this card. Check the details and try again.");
    pspToken = ((await res.json()) as { token: string }).token;
  }
  return api<SavedCard>("POST", "/v1/me/cards", {
    auth: "required",
    body: {
      sessionId: session.sessionId,
      pspToken,
      brand,
      last4: number.slice(-4),
      expiry: input.expiry,
      holderName: input.name.trim(),
      fingerprint: `${brand}-${number.slice(0, 6)}-${number.slice(-4)}-${input.expiry}`,
    },
  }).catch(asAccountError);
}

export const removeCard = (id: string) =>
  api<void>("DELETE", `/v1/me/cards/${encodeURIComponent(id)}`, { auth: "required" }).catch(asAccountError);

export const getCredit = () => api<CreditAccount>("GET", "/v1/me/credit", { auth: "required" });

export const getPlus = () => api<PlusMembership>("GET", "/v1/me/plus", { auth: "required" });

export const joinPlus = (plan: PlusPlan, cardId: string) =>
  api<PlusMembership>("POST", "/v1/me/plus", {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: { plan, cardId },
  }).catch(asAccountError);

export const cancelPlus = () =>
  api<PlusMembership>("DELETE", "/v1/me/plus", { auth: "required" }).catch(asAccountError);
