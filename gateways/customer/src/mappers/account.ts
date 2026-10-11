import type { SavedCard as PbSavedCard } from "@kade/proto/kade/payment/v1/payment_service";
import {
  PlusPlan,
  PlusStatus,
  type CreditAccount as PbCreditAccount,
  type Customer,
  type PlusMembership as PbPlus,
} from "@kade/proto/kade/profile/v1/profile_service";
import {
  ReferredFriendStatus,
  type GetReferralResponse,
  type GiftCard as PbGiftCard,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { MessageAuthorKind, type TicketMessage } from "@kade/proto/kade/support/v1/support_service";
import { toRupees } from "../money.js";
import type {
  ChatMessage,
  CreditAccount,
  GiftCard,
  PlusMembership,
  Referral,
  SavedCard,
  User,
} from "../schemas.js";
import { brandName } from "./orders.js";

/** "+94771234567" -> "771234567" (the app's national format without the leading 0). */
export function nationalPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("94") && d.length === 11) return d.slice(2);
  if (d.startsWith("0") && d.length === 10) return d.slice(1);
  return d;
}

/** App phone ("771234567") -> E.164, or "" when it isn't a Sri Lankan mobile. */
export function e164Phone(national: string): string {
  const d = nationalPhone(national);
  return /^7\d{8}$/.test(d) ? `+94${d}` : "";
}

export function toUser(c: Customer | undefined): User {
  const out: User = { name: c?.name ?? "", phone: nationalPhone(c?.phone ?? "") };
  if (c?.email) out.email = c.email;
  return out;
}

export function toCard(c: PbSavedCard): SavedCard {
  return {
    id: c.id,
    brand: brandName(c.brand),
    last4: c.last4,
    expiry: `${String(c.expiryMonth).padStart(2, "0")}/${String(c.expiryYear % 100).padStart(2, "0")}`,
  };
}

export function toCredit(a: PbCreditAccount | undefined): CreditAccount {
  return {
    balance: toRupees(a?.balance),
    history: (a?.history ?? []).map((e) => ({
      id: e.id,
      at: e.at?.getTime() ?? 0,
      amount: toRupees(e.amount),
      label: e.label,
    })),
  };
}

export function toPlus(m: PbPlus | undefined): PlusMembership {
  if (!m || m.status === PlusStatus.PLUS_STATUS_NONE || m.status === PlusStatus.PLUS_STATUS_UNSPECIFIED) {
    return { status: "none" };
  }
  const out: PlusMembership = {
    status: m.status === PlusStatus.PLUS_STATUS_CANCELLED ? "cancelled" : "member",
    plan: m.plan === PlusPlan.PLUS_PLAN_YEARLY ? "yearly" : "monthly",
  };
  if (m.joinedAt) out.joinedAt = m.joinedAt.getTime();
  if (m.trialEndsAt) out.trialEndsAt = m.trialEndsAt.getTime();
  if (m.endsAt) out.endsAt = m.endsAt.getTime();
  if (m.cardLabel) out.cardLabel = m.cardLabel;
  return out;
}

export function toGiftCard(g: PbGiftCard): GiftCard {
  return {
    id: g.id,
    amount: toRupees(g.amount),
    to: g.to,
    contact: g.contact,
    message: g.message,
    sendOn: g.sendOn,
    cardId: g.cardId,
    boughtAt: g.boughtAt?.getTime() ?? 0,
    cardLabel: g.cardLabel,
  };
}

const FRIEND_STATUS: Record<number, "invited" | "joined" | "ordered"> = {
  [ReferredFriendStatus.REFERRED_FRIEND_STATUS_INVITED]: "invited",
  [ReferredFriendStatus.REFERRED_FRIEND_STATUS_JOINED]: "joined",
  [ReferredFriendStatus.REFERRED_FRIEND_STATUS_ORDERED]: "ordered",
};

export function toReferral(r: GetReferralResponse): Referral {
  return {
    code: r.code,
    reward: toRupees(r.reward),
    friends: r.friends.map((f) => ({
      name: f.name,
      status: FRIEND_STATUS[f.status] ?? "invited",
      at: f.at?.getTime() ?? 0,
    })),
  };
}

export function toChatMessage(m: TicketMessage): ChatMessage {
  const out: ChatMessage = {
    id: m.id,
    from: m.from === MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER ? "you" : "agent",
    text: m.body,
    at: m.at?.getTime() ?? 0,
  };
  if (m.order) {
    out.order = {
      id: m.order.orderNumber || m.order.orderId,
      restaurant: m.order.restaurantName,
      total: toRupees(m.order.total),
    };
  }
  return out;
}
