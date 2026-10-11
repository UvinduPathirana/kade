import type { Order } from "@kade/proto/kade/order/v1/order_service";
import {
  HelpAudience,
  IssueKind,
  RequesterKind,
  TicketCategory,
  TicketPriority,
  type HelpTopic,
  type IssueLine,
} from "@kade/proto/kade/support/v1/support_service";

const MIN = 60_000;

/** SLA to first response: urgent 15 min, high 1 h, normal 4 h, low 24 h. */
export const SLA_MS: Record<number, number> = {
  [TicketPriority.TICKET_PRIORITY_URGENT]: 15 * MIN,
  [TicketPriority.TICKET_PRIORITY_HIGH]: 60 * MIN,
  [TicketPriority.TICKET_PRIORITY_NORMAL]: 240 * MIN,
  [TicketPriority.TICKET_PRIORITY_LOW]: 1_440 * MIN,
};

export function slaDue(openedAt: Date, priority: TicketPriority): Date {
  return new Date(openedAt.getTime() + (SLA_MS[priority] ?? SLA_MS[TicketPriority.TICKET_PRIORITY_NORMAL]!));
}

/** Breached = no first response before the due time (late answers still count as breached). */
export function isBreached(t: { slaDueAt: Date; firstResponseAt: Date | null }, now: Date): boolean {
  return t.firstResponseAt ? t.firstResponseAt > t.slaDueAt : now > t.slaDueAt;
}

/** Goodwill credit cap per ticket (admin console: "between Rs 1 and Rs 5,000"). */
export const MAX_CREDIT_MINOR = 5_000_00;
export const MAX_MESSAGE = 2_000;
export const MAX_NOTE = 1_000;

/** "Rs 1,150" from LKR minor units. */
export function formatRs(amountMinor: number): string {
  return `Rs ${Math.round(amountMinor / 100).toLocaleString("en-US")}`;
}

/** Rounds minor units to whole rupees, as the apps show them. */
const wholeRupees = (minor: number): number => Math.round(minor / 100) * 100;

/**
 * What support pays back for a problem (customer app issueAmount):
 * missing/wrong/spilled → Σ unit_price × min(qty, ordered) × (1 − restaurant discount%);
 * late → max(delivery_fee, Rs 200); never arrived → total + credit used; charged → 0 (agent reviews).
 */
export function issueAmount(order: Order, kind: IssueKind, lines: IssueLine[]): number {
  const totals = order.totals;
  switch (kind) {
    case IssueKind.ISSUE_KIND_MISSING:
    case IssueKind.ISSUE_KIND_WRONG:
    case IssueKind.ISSUE_KIND_SPILLED: {
      const full = lines.reduce((sum, { lineKey, quantity }) => {
        const line = order.lines.find((l) => l.key === lineKey);
        if (!line || quantity <= 0) return sum;
        return sum + (line.unitPrice?.amountMinor ?? 0) * Math.min(quantity, line.quantity);
      }, 0);
      const discount = order.restaurant?.discountPercent ?? 0;
      return wholeRupees(full * (1 - discount / 100));
    }
    case IssueKind.ISSUE_KIND_LATE:
      return Math.max(totals?.deliveryFee?.amountMinor ?? 0, 200_00);
    case IssueKind.ISSUE_KIND_NEVER_ARRIVED:
      return (totals?.total?.amountMinor ?? 0) + (totals?.credit?.amountMinor ?? 0);
    default:
      return 0;
  }
}

export const ISSUE_CATEGORY: Record<number, TicketCategory> = {
  [IssueKind.ISSUE_KIND_MISSING]: TicketCategory.TICKET_CATEGORY_MISSING_ITEM,
  [IssueKind.ISSUE_KIND_WRONG]: TicketCategory.TICKET_CATEGORY_WRONG_ITEM,
  [IssueKind.ISSUE_KIND_SPILLED]: TicketCategory.TICKET_CATEGORY_DAMAGED,
  [IssueKind.ISSUE_KIND_LATE]: TicketCategory.TICKET_CATEGORY_LATE,
  [IssueKind.ISSUE_KIND_NEVER_ARRIVED]: TicketCategory.TICKET_CATEGORY_NEVER_ARRIVED,
  [IssueKind.ISSUE_KIND_CHARGED]: TicketCategory.TICKET_CATEGORY_PAYMENT,
};

export const ISSUE_PRIORITY: Record<number, TicketPriority> = {
  [IssueKind.ISSUE_KIND_NEVER_ARRIVED]: TicketPriority.TICKET_PRIORITY_URGENT,
  [IssueKind.ISSUE_KIND_CHARGED]: TicketPriority.TICKET_PRIORITY_HIGH,
  [IssueKind.ISSUE_KIND_MISSING]: TicketPriority.TICKET_PRIORITY_HIGH,
  [IssueKind.ISSUE_KIND_WRONG]: TicketPriority.TICKET_PRIORITY_HIGH,
  [IssueKind.ISSUE_KIND_SPILLED]: TicketPriority.TICKET_PRIORITY_HIGH,
  [IssueKind.ISSUE_KIND_LATE]: TicketPriority.TICKET_PRIORITY_NORMAL,
};

export function issueSubject(kind: IssueKind, orderNumber: string): string {
  switch (kind) {
    case IssueKind.ISSUE_KIND_MISSING:
      return `Missing items from ${orderNumber}`;
    case IssueKind.ISSUE_KIND_WRONG:
      return `Wrong items in ${orderNumber}`;
    case IssueKind.ISSUE_KIND_SPILLED:
      return `Spilled or damaged food in ${orderNumber}`;
    case IssueKind.ISSUE_KIND_LATE:
      return `${orderNumber} arrived late`;
    case IssueKind.ISSUE_KIND_NEVER_ARRIVED:
      return `${orderNumber} never arrived`;
    case IssueKind.ISSUE_KIND_CHARGED:
      return `Charged wrongly for ${orderNumber}`;
    default:
      return `Problem with ${orderNumber}`;
  }
}

/** The requester's first message, written for the agent reading the queue. */
export function issueMessage(order: Order, kind: IssueKind, lines: IssueLine[], note: string): string {
  const dishes = lines
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const line = order.lines.find((x) => x.key === l.lineKey);
      return `${Math.min(l.quantity, line?.quantity ?? l.quantity)} × ${line?.name ?? l.lineKey}`;
    });
  const what: Record<number, string> = {
    [IssueKind.ISSUE_KIND_MISSING]: "Missing",
    [IssueKind.ISSUE_KIND_WRONG]: "Wrong",
    [IssueKind.ISSUE_KIND_SPILLED]: "Spilled or damaged",
  };
  const parts: string[] = [];
  if (what[kind] && dishes.length) parts.push(`${what[kind]}: ${dishes.join(", ")}.`);
  if (kind === IssueKind.ISSUE_KIND_LATE) parts.push("The order arrived late.");
  if (kind === IssueKind.ISSUE_KIND_NEVER_ARRIVED) parts.push("The order never arrived.");
  if (note.trim()) parts.push(note.trim());
  return parts.join(" ") || issueSubject(kind, order.orderNumber);
}

export const SUPPORT_AGENT = "Tharushi";
export const SUPPORT_PHONE = "+94 11 750 0500";

/** First message in a new chat (customer app greeting(); riders and restaurants get their own). */
export function greeting(kind: RequesterKind, name: string): string {
  const first = name.trim().split(/\s+/)[0];
  const hi = `Hi${first ? ` ${first}` : ""}`;
  switch (kind) {
    case RequesterKind.REQUESTER_KIND_RIDER:
      return `${hi}, rider support here. Tell us what's happening and we'll sort it out. If you're on a trip, the order is already in front of us.`;
    case RequesterKind.REQUESTER_KIND_RESTAURANT:
      return `${hi}, I'm ${SUPPORT_AGENT} from Kadé partner support. What can I help with? Order numbers help us find things quickly.`;
    default:
      return `${hi}, I'm ${SUPPORT_AGENT} from Kadé support. What can I help with? If it's about an order, attach it and I'll have the details in front of me.`;
  }
}

export const HELP_TOPICS: Record<number, HelpTopic[]> = {
  [HelpAudience.HELP_AUDIENCE_RIDER]: [
    {
      id: "accident",
      title: "I've had an accident",
      summary: "Get safe first. We'll handle the order.",
      steps: [
        "Move off the road if you can. If anyone is hurt, call 1990 for an ambulance.",
        "Call 119 if the police are needed.",
        "Call Kadé rider support. We'll cancel or reassign the order so you don't have to.",
        "Take photos of your vehicle and the place when it's safe. Insurance will ask for them.",
      ],
    },
    {
      id: "unreachable",
      title: "Customer isn't answering",
      summary: "Call twice, message, then wait 5 minutes.",
      steps: [
        "Call through the app twice, a minute apart.",
        'Send a quick message: "I\'m at your gate".',
        "Wait 5 minutes at the address. The app records your waiting time.",
        "Still nothing? Chat with support. We'll tell you whether to leave it or bring it back.",
      ],
    },
    {
      id: "delay",
      title: "Restaurant is running late",
      summary: "Waiting over 10 minutes is paid.",
      steps: [
        'Tap "Order not ready yet" on the pickup screen so the kitchen\'s estimate is recorded.',
        "Waiting time after the first 10 minutes is paid at Rs 10 a minute.",
        "If the wait goes past 20 minutes, chat with support and we'll let the customer know.",
      ],
    },
    {
      id: "payment",
      title: "Problem with pay or cash",
      summary: "Missing pay, wrong cash amount or deposits.",
      steps: [
        "Check the trip's pay breakdown in Trips first.",
        "For a cash mismatch, note the order number and what the customer paid.",
        "Chat with support with the order number. Pay fixes show in the next weekly payout.",
      ],
    },
  ],
  [HelpAudience.HELP_AUDIENCE_CUSTOMER]: [
    {
      id: "missing",
      title: "Something was missing or wrong",
      summary: "Get money back for the dishes affected.",
      steps: [
        'Open the order from Orders and tap "Get help with this order".',
        "Pick the dishes that were missing, wrong or spilled.",
        "Choose Kadé credit (instant) or a refund to your card (5 to 7 working days).",
      ],
    },
    {
      id: "late",
      title: "My order is late",
      summary: "Follow it live, or tell us if it's well past the time.",
      steps: [
        "The live map on the order page updates every few seconds.",
        "If it's more than 15 minutes past the time shown, chat with us and we'll call the rider.",
        "If it arrives very late, report it from the order and we'll refund the delivery fee.",
      ],
    },
    {
      id: "refunds",
      title: "Refunds and Kadé credit",
      summary: "Credit is instant; card refunds take a few days.",
      steps: [
        "Refunds to Kadé credit show in Account straight away and work on your next order.",
        "Card refunds take 5 to 7 working days, depending on your bank.",
        "Cash orders are refunded as Kadé credit.",
      ],
    },
    {
      id: "cancel",
      title: "Cancelling an order",
      summary: "Free until the kitchen accepts.",
      steps: [
        "Cancel from the order page until the restaurant accepts, usually within a minute.",
        "After that, chat with us and we'll see what we can do.",
      ],
    },
  ],
  [HelpAudience.HELP_AUDIENCE_RESTAURANT]: [
    {
      id: "tablet",
      title: "Tablet logged out or offline",
      summary: "Keep orders coming in while you fix it.",
      steps: [
        "Check the tablet is charging and on the shop Wi-Fi.",
        "Sign in again with the outlet's number; orders that came in are still waiting.",
        "Call partner support if you missed orders. We'll sort out the customers.",
      ],
    },
    {
      id: "busy",
      title: "Too busy to keep up",
      summary: "Use busy mode instead of rejecting orders.",
      steps: [
        "Turn on busy mode to add 10, 20 or 30 minutes to every new order.",
        "Pause new orders for up to an hour if the kitchen is overwhelmed.",
      ],
    },
    {
      id: "payout",
      title: "Payout looks wrong",
      summary: "Payouts go out every Tuesday.",
      steps: [
        "Check the week's statement in Payouts for refunds and commission.",
        "Chat with partner support with the order numbers you're unsure about.",
      ],
    },
  ],
};
