import { PlusPlan, PlusStatus, type PlusMembership } from "@kade/proto/kade/profile/v1/profile_service";
import type { plusMemberships } from "../db/schema.js";
import { lkr } from "../shared/money.js";

export type PlusRow = typeof plusMemberships.$inferSelect;

const DAY = 86_400_000;
export const TRIAL_MS = 30 * DAY;

/** Kadé Plus prices in LKR minor units (apps: Rs 990 a month, Rs 9,900 a year). */
export const PLUS_PRICE_MINOR: Record<PlusPlan.PLUS_PLAN_MONTHLY | PlusPlan.PLUS_PLAN_YEARLY, number> = {
  [PlusPlan.PLUS_PLAN_MONTHLY]: 99_000,
  [PlusPlan.PLUS_PLAN_YEARLY]: 990_000,
};

export const periodMs = (plan: number): number => (plan === PlusPlan.PLUS_PLAN_YEARLY ? 365 : 30) * DAY;

/** Next charge: the end of the free month, then every period after it (same rule as the app). */
export function plusRenewsAt(row: Pick<PlusRow, "trialEndsAt" | "plan">, now: number): Date {
  const start = row.trialEndsAt.getTime();
  if (now < start) return new Date(start);
  const period = periodMs(row.plan);
  return new Date(start + Math.max(1, Math.ceil((now - start) / period)) * period);
}

/** Benefits apply: a member, or cancelled but still inside the time already paid for. */
export function plusActive(row: Pick<PlusRow, "status" | "endsAt"> | undefined, now: number): boolean {
  if (!row) return false;
  if (row.status === PlusStatus.PLUS_STATUS_MEMBER) return true;
  return row.status === PlusStatus.PLUS_STATUS_CANCELLED && (row.endsAt?.getTime() ?? 0) > now;
}

export function plusToProto(row: PlusRow | undefined, now: number): PlusMembership {
  if (!row) {
    return {
      status: PlusStatus.PLUS_STATUS_NONE,
      plan: PlusPlan.PLUS_PLAN_UNSPECIFIED,
      cardId: "",
      cardLabel: "",
      active: false,
    };
  }
  const member = row.status === PlusStatus.PLUS_STATUS_MEMBER;
  return {
    status: row.status,
    plan: row.plan,
    joinedAt: row.joinedAt,
    trialEndsAt: row.trialEndsAt,
    endsAt: row.endsAt ?? undefined,
    renewsAt: member ? plusRenewsAt(row, now) : undefined,
    cardId: row.cardId,
    cardLabel: row.cardLabel,
    price: lkr(row.priceMinor),
    active: plusActive(row, now),
  };
}

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mc: "Mastercard",
  mastercard: "Mastercard",
  amex: "Amex",
};

/**
 * "Visa •••• 4242" from a card id like the app's "visa-4242" / "mastercard-0002-…". Payment's
 * saved-card ids are opaque UUIDs: those get "Saved card" (the gateway may pass a nicer label later).
 */
export function cardLabel(cardId: string): string {
  const m = /^([a-z]+)-(\d{4})/i.exec(cardId);
  const brand = m ? BRANDS[m[1]!.toLowerCase()] : undefined;
  return brand && m ? `${brand} •••• ${m[2]}` : "Saved card";
}
