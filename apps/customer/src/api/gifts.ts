// Gift cards and referrals. Later: the payments service (POST /gift-cards) and the growth service
// (GET /me/referral). Today a mock persisted in localStorage.
import { cardLabel } from "@/lib/cards";
import { AccountError, listCards } from "./account";
import type { GiftCard, GiftCardInput, Referral } from "./types";

const KEY = "kade.giftcards.v1";
const DAY = 86_400_000;

export const GIFT_MIN = 500;
export const GIFT_MAX = 25_000;
export const REFERRAL_REWARD = 500;

const latency = () => new Promise((r) => setTimeout(r, 450));

function readAll(): GiftCard[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as GiftCard[];
  } catch {
    return [];
  }
}

export async function listGiftCards(): Promise<GiftCard[]> {
  return readAll();
}

/** "2026-10-10" in Colombo time, for date inputs and comparisons. */
export const isoDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

export async function buyGiftCard(input: GiftCardInput): Promise<GiftCard> {
  await latency();
  if (!Number.isInteger(input.amount) || input.amount < GIFT_MIN || input.amount > GIFT_MAX)
    throw new AccountError("Gift cards can be from Rs 500 to Rs 25,000.");
  if (!input.to.trim()) throw new AccountError("Add the name of the person you're sending it to.");
  if (!input.contact.trim()) throw new AccountError("Add their mobile number or email so we can send it.");
  if (input.sendOn < isoDay(Date.now())) throw new AccountError("Choose today or a date in the future.");
  const card = (await listCards()).find((c) => c.id === input.cardId);
  if (!card) throw new AccountError("Choose a card to pay with.");
  const gift: GiftCard = {
    ...input,
    to: input.to.trim(),
    contact: input.contact.trim(),
    message: input.message.trim(),
    id: `GC-${Math.floor(100000 + Math.random() * 900000)}`,
    boughtAt: Date.now(),
    cardLabel: cardLabel(card),
  };
  localStorage.setItem(KEY, JSON.stringify([gift, ...readAll()]));
  return gift;
}

/** The customer's invite code and who has used it. */
export async function getReferral(firstName: string): Promise<Referral> {
  const now = Date.now();
  const stem =
    firstName
      .normalize("NFD")
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase()
      .slice(0, 8) || "KADE";
  return {
    code: `${stem}${REFERRAL_REWARD}`,
    reward: REFERRAL_REWARD,
    friends: [
      { name: "Kasun", status: "ordered", at: now - 4 * DAY },
      { name: "Sachini", status: "joined", at: now - 2 * DAY },
      { name: "Nuwan", status: "invited", at: now - DAY },
    ],
  };
}
