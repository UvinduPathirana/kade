import { Channel } from "@kade/proto/kade/notification/v1/notification_service";
import { invalidArgument } from "../platform/grpc/errors.js";

/**
 * Message templates, in the apps' voice: plain Sri Lankan English, short, no exclamation spam.
 * Each template names the params it needs; `{name}` placeholders are filled from them.
 * Optional params are written `{name?}` and render as "" when missing.
 */
export interface Template {
  id: string;
  /** Used when the caller leaves channel unspecified. */
  channel: Channel;
  /** Email subject (email channel only). */
  subject?: string;
  text: string;
}

const t = (id: string, channel: Channel, text: string, subject?: string): Template => ({
  id,
  channel,
  text,
  subject,
});

const { CHANNEL_SMS: SMS, CHANNEL_PUSH: PUSH, CHANNEL_EMAIL: EMAIL } = Channel;

export const TEMPLATES: Record<string, Template> = Object.fromEntries(
  [
    // Sign-in and accounts
    t("otp", SMS, "{code} is your Kadé code. It expires in 5 minutes. Don't share it with anyone."),
    t(
      "staff_invite",
      SMS,
      "{inviter} added you to {outlet} on Kadé Partner. Download the app and sign in with this number.",
    ),
    t("rider_message", SMS, "Kadé rider {rider}: {text}"),
    t("gift_card", SMS, "{from} sent you a Kadé gift card worth {amount}. Use code {code} at checkout."),
    t(
      "statement_ready",
      EMAIL,
      "Hi {name}, your Kadé statement for {period} is ready in the app.",
      "Your Kadé statement is ready",
    ),

    // Orders (customer)
    t(
      "order_placed",
      PUSH,
      "We've sent order {orderNumber} to {restaurant}. We'll let you know as soon as they accept.",
    ),
    t("order_scheduled", PUSH, "Order {orderNumber} from {restaurant} is booked for {when}."),
    t(
      "order_accepted",
      PUSH,
      "{restaurant} accepted order {orderNumber} and is cooking now. About {minutes} min to go.",
    ),
    t(
      "order_accepted_pickup",
      PUSH,
      "{restaurant} accepted order {orderNumber}. It'll be ready to collect in about {minutes} min.",
    ),
    t("order_rejected", PUSH, "Sorry, {restaurant} couldn't take order {orderNumber}: {reason}. {money}"),
    t(
      "order_ready_pickup",
      PUSH,
      "Order {orderNumber} is ready to collect at {restaurant}. Show the order number at the counter.",
    ),
    t("rider_assigned", PUSH, "{rider} is picking up your order from {restaurant}."),
    t("order_picked_up", PUSH, "{rider} is on the way with your order from {restaurant}."),
    t(
      "rider_arrived",
      PUSH,
      "{rider} is at your gate with order {orderNumber}. Have your delivery code ready.",
    ),
    t(
      "order_delivered",
      PUSH,
      "Order {orderNumber} from {restaurant} has been delivered. Enjoy your meal, and tap to rate {rider} and the food.",
    ),
    t("order_collected", PUSH, "Enjoy your meal. Tap to tell {restaurant} how order {orderNumber} was."),
    t("order_cancelled", PUSH, "Order {orderNumber} from {restaurant} is cancelled. {money}"),
    t(
      "order_cancelled_by_kade",
      PUSH,
      "Sorry, we had to cancel order {orderNumber} from {restaurant}: {reason}. {money}",
    ),
    t(
      "order_refunded_credit",
      PUSH,
      "{amount} for order {orderNumber} is back in your Kadé credit, ready to use now.",
    ),
    t(
      "order_refunded_card",
      PUSH,
      "We've refunded {amount} for order {orderNumber} to your card. It can take 5 to 7 working days to show.",
    ),

    // Payments (customer)
    t(
      "payment_declined",
      PUSH,
      "Your card{card?} was declined for {amount}. Try another card or pay cash on delivery.",
    ),
    t(
      "payment_refund_failed",
      SMS,
      "We couldn't send your {amount} refund for order {orderNumber} to your card. Kadé support will sort it out and message you.",
    ),

    // Support
    t("ticket_reply", PUSH, "{agent} from Kadé support: {text}"),
    t("ticket_resolved", PUSH, "Your support request is resolved. {summary}"),
  ].map((tpl) => [tpl.id, tpl]),
);

const PLACEHOLDER = /\{(\w+)(\?)?\}/g;

/** Renders a template. Throws INVALID_ARGUMENT for an unknown template or a missing param. */
export function render(
  templateId: string,
  params: Record<string, string>,
): { body: string; template: Template } {
  const template = TEMPLATES[templateId];
  if (!template) {
    throw invalidArgument("TEMPLATE_UNKNOWN", `There's no message template called "${templateId}".`, {
      template: templateId,
    });
  }
  const missing: string[] = [];
  const body = template.text
    .replace(PLACEHOLDER, (_, key: string, optional?: string) => {
      const value = params[key];
      if (value === undefined || value === "") {
        if (!optional) missing.push(key);
        return "";
      }
      return value;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (missing.length > 0) {
    throw invalidArgument("TEMPLATE_PARAM_MISSING", `Missing ${missing.join(", ")} for "${templateId}".`, {
      template: templateId,
      params: missing.join(","),
    });
  }
  return { body, template };
}

/** "Rs 1,150" from LKR minor units (apps show whole rupees). */
export function formatRs(amountMinor: number): string {
  return `Rs ${Math.round(amountMinor / 100).toLocaleString("en-US")}`;
}

/** "Nimal" from "Nimal Fernando". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** "7:30 pm on Sat 12 Oct" in Colombo time. */
export function formatWhen(at: Date): string {
  const time = at
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Colombo",
    })
    .replace(/\s/g, " ")
    .toLowerCase();
  const day = at.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Colombo",
  });
  return `${time} on ${day.replace(",", "")}`;
}
