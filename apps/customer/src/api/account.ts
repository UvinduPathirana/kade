// Account API. Later: the auth service (SMS codes, Google and Apple sign-in), the customer service
// (profile), the payments service (saved cards, Kadé credit) and the subscriptions service (Kadé Plus).
// Today every call is a mock backed by localStorage.
import { cardBrand, cardLabel, digitsOnly, validateCard } from "@/lib/cards";
import type {
  CreditAccount,
  NewCardInput,
  PlusMembership,
  PlusPlan,
  SavedCard,
  SignInResult,
  User,
} from "./types";

const USERS_KEY = "kade.users.v1";
const CARDS_KEY = "kade.cards.v1";
const CREDIT_KEY = "kade.credit.v1";
const PLUS_KEY = "kade.plus.v1";

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

const latency = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

// ---------- Sign in ----------

/** The demo doesn't send texts; this is the code every number receives. */
export const DEMO_CODE = "123456";
export const RESEND_AFTER_SECONDS = 30;

/** "+94 77 123 4567" */
export const formatPhone = (phone: string) =>
  `+94 ${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5)}`.trim();

/** Accepts "077 123 4567", "77-123-4567" or "+94771234567"; returns "771234567" or null. */
export function normalisePhone(raw: string): string | null {
  let d = digitsOnly(raw);
  if (d.startsWith("94") && d.length === 11) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return /^7\d{8}$/.test(d) ? d : null;
}

export async function requestCode(phone: string): Promise<void> {
  await latency();
  if (!normalisePhone(phone))
    throw new AccountError("Enter a Sri Lankan mobile number: 9 digits after +94, starting with 7.");
}

export async function verifyCode(phone: string, code: string): Promise<SignInResult> {
  await latency();
  if (digitsOnly(code) !== DEMO_CODE)
    throw new AccountError(
      `That code doesn't match the one sent to ${formatPhone(phone)}. Check the text and try again, or send a new code.`,
    );
  const known = read<Record<string, User>>(USERS_KEY, {})[phone];
  return known ? { user: known, isNew: false } : { user: { name: "", phone }, isNew: true };
}

/** Mock of the Google / Apple consent screens: they hand back a name and email. */
export async function signInWithProvider(provider: "google" | "apple"): Promise<SignInResult> {
  await latency(600);
  const email = provider === "google" ? "dilini.perera@gmail.com" : "dilini.p@privaterelay.appleid.com";
  const users = read<Record<string, User>>(USERS_KEY, {});
  const known = Object.values(users).find((u) => u.email === email);
  return { user: known ?? { name: "Dilini Perera", phone: "", email }, isNew: !known };
}

export async function saveProfile(user: User): Promise<User> {
  await latency();
  if (!user.name.trim()) throw new AccountError("Enter your name so riders know who to ask for.");
  if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email))
    throw new AccountError("That email address looks incomplete. Check it has an @ and a domain.");
  const clean = { ...user, name: user.name.trim(), email: user.email?.trim() || undefined };
  const users = read<Record<string, User>>(USERS_KEY, {});
  users[clean.phone || clean.email!] = clean;
  write(USERS_KEY, users);
  return clean;
}

// ---------- Saved cards ----------

const defaultCards: SavedCard[] = [
  { id: "visa-4242", brand: "Visa", last4: "4242", expiry: "08/28" },
  { id: "mc-0002", brand: "Mastercard", last4: "0002", expiry: "03/29" },
];

/** Demo: the bank declines any card ending 0002, so the payment-failed state can be seen. */
export const DECLINING_LAST4 = "0002";

/** Card-network test numbers. The demo refuses anything else so no real card is ever typed in. */
const TEST_NUMBERS = new Set([
  "4242424242424242",
  "4000056655665556",
  "5555555555554444",
  "5200828282828210",
  "2223003122003222",
  "378282246310005",
  "4000000000000002",
]);

export async function listCards(): Promise<SavedCard[]> {
  return read(CARDS_KEY, defaultCards);
}

export async function addCard(input: NewCardInput): Promise<SavedCard> {
  await latency();
  const errors = validateCard(input);
  const first = Object.values(errors)[0];
  if (first) throw new AccountError(first);
  const number = digitsOnly(input.number);
  if (!TEST_NUMBERS.has(number))
    throw new AccountError(
      "This demo only accepts test card numbers. Use 4242 4242 4242 4242 with any future date.",
    );
  const cards = read(CARDS_KEY, defaultCards);
  const last4 = number.slice(-4);
  const brand = cardBrand(number)!;
  if (cards.some((c) => c.brand === brand && c.last4 === last4 && c.expiry === input.expiry))
    throw new AccountError(`${cardLabel({ brand, last4 })} is already saved.`);
  const card: SavedCard = {
    id: `${brand}-${last4}-${Date.now()}`.toLowerCase(),
    brand,
    last4,
    expiry: input.expiry,
  };
  write(CARDS_KEY, [...cards, card]);
  return card;
}

export async function removeCard(id: string): Promise<void> {
  await latency();
  write(
    CARDS_KEY,
    read(CARDS_KEY, defaultCards).filter((c) => c.id !== id),
  );
}

// ---------- Kadé credit ----------

const defaultCredit: CreditAccount = {
  balance: 500,
  history: [
    { id: "c0", at: Date.now() - 4 * DAY, amount: 500, label: "Kasun's first order, from your invite" },
  ],
};

export async function getCredit(): Promise<CreditAccount> {
  return read(CREDIT_KEY, defaultCredit);
}

/** Called by the order service (refunds as credit) and at checkout (spending it). */
export function changeCredit(amount: number, label: string): CreditAccount {
  const credit = read(CREDIT_KEY, defaultCredit);
  const next: CreditAccount = {
    balance: Math.max(0, credit.balance + amount),
    history: [{ id: `c${Date.now()}`, at: Date.now(), amount, label }, ...credit.history],
  };
  write(CREDIT_KEY, next);
  return next;
}

/** Current balance, read synchronously by the mock order service. */
export const creditBalance = () => read(CREDIT_KEY, defaultCredit).balance;

// ---------- Kadé Plus ----------

export const PLUS_PRICES: Record<PlusPlan, number> = { monthly: 990, yearly: 9900 };

export async function getPlus(): Promise<PlusMembership> {
  return read<PlusMembership>(PLUS_KEY, { status: "none" });
}

/** True while Plus benefits apply: a member, or cancelled but inside the time already paid for. */
export function plusActive(m: PlusMembership | undefined, now = Date.now()): boolean {
  if (!m) return false;
  return m.status === "member" || (m.status === "cancelled" && (m.endsAt ?? 0) > now);
}

/** When the next payment is taken: the end of the free month, then every month or year after. */
export function plusRenewsAt(m: PlusMembership, now = Date.now()): number {
  const start = m.trialEndsAt ?? now;
  if (now < start) return start;
  const period = (m.plan === "yearly" ? 365 : 30) * DAY;
  return start + Math.ceil((now - start) / period) * period;
}

export const isPlusMember = () => plusActive(read<PlusMembership>(PLUS_KEY, { status: "none" }));

export async function joinPlus(plan: PlusPlan, cardId: string): Promise<PlusMembership> {
  await latency();
  const card = read(CARDS_KEY, defaultCards).find((c) => c.id === cardId);
  if (!card) throw new AccountError("Choose a card for when the free month ends.");
  const now = Date.now();
  const m: PlusMembership = {
    status: "member",
    plan,
    joinedAt: now,
    trialEndsAt: now + 30 * DAY,
    cardLabel: cardLabel(card),
  };
  write(PLUS_KEY, m);
  return m;
}

export async function cancelPlus(): Promise<PlusMembership> {
  await latency();
  const m = read<PlusMembership>(PLUS_KEY, { status: "none" });
  if (m.status !== "member") throw new AccountError("You're not a Kadé Plus member.");
  const next: PlusMembership = { ...m, status: "cancelled", endsAt: plusRenewsAt(m) };
  write(PLUS_KEY, next);
  return next;
}
