// Gift cards and referrals (promotion) against the customer gateway.
import { AccountError } from "../errors";
import { api, newIdempotencyKey } from "../http";
import type { GiftCard, GiftCardInput, Referral } from "../types";
import { asAccountError } from "./account";

export const listGiftCards = () => api<GiftCard[]>("GET", "/v1/me/gift-cards", { auth: "required" });

export async function buyGiftCard(
  input: GiftCardInput,
  limits: { min: number; max: number },
): Promise<GiftCard> {
  if (!Number.isInteger(input.amount) || input.amount < limits.min || input.amount > limits.max)
    throw new AccountError("Gift cards can be from Rs 500 to Rs 25,000.");
  if (!input.cardId) throw new AccountError("Choose a card to pay with.");
  return api<GiftCard>("POST", "/v1/me/gift-cards", {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: input,
  }).catch(asAccountError);
}

export const getReferral = (firstName: string) =>
  api<Referral>("GET", "/v1/me/referral", { auth: "required", query: { firstName } });
