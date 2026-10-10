// Customers API. Later: the customer service (profiles, credit wallet, blocks) and the risk service
// that raises fraud flags.
import { formatRs } from "@kade/ui";
import { ApiError, audit, find, ME, respond, simNow } from "./client";
import { orders, refunds, restaurantById } from "./mock/orders";
import { customers } from "./mock/partners";
import type { Customer, OrderStatus, Refund } from "./types";

export interface CustomerView extends Customer {
  refundCount: number;
  refundTotal: number;
  cancelCount: number;
  openFlags: number;
  lastOrderAt?: number;
}

const view = (c: Customer): CustomerView => {
  const mine = orders.filter((o) => o.customerId === c.id);
  const theirRefunds = refunds.filter((r) => r.customerId === c.id);
  return {
    ...c,
    refundCount: theirRefunds.length,
    refundTotal: theirRefunds.reduce((s, r) => s + r.amount, 0),
    cancelCount: mine.filter((o) => o.status === "cancelled").length,
    openFlags: c.flags.filter((f) => f.status === "open").length,
    lastOrderAt: mine.reduce<number | undefined>(
      (m, o) => (m === undefined || o.placedAt > m ? o.placedAt : m),
      undefined,
    ),
  };
};

export const listCustomers = () => respond(customers.map(view));

export interface CustomerDetail extends CustomerView {
  orders: {
    id: string;
    placedAt: number;
    restaurantName: string;
    total: number;
    status: OrderStatus;
    refunded: number;
  }[];
  refunds: Refund[];
}

export async function getCustomer(id: string): Promise<CustomerDetail> {
  const c = find(customers, (x) => x.id === id, "Customer");
  return respond({
    ...view(c),
    orders: orders
      .filter((o) => o.customerId === id)
      .sort((a, b) => b.placedAt - a.placedAt)
      .slice(0, 12)
      .map((o) => ({
        id: o.id,
        placedAt: o.placedAt,
        restaurantName: restaurantById(o.restaurantId).name,
        total: o.total,
        status: o.status,
        refunded: o.refunded,
      })),
    refunds: refunds.filter((r) => r.customerId === id),
  });
}

export async function issueCredit({ id, amount, reason }: { id: string; amount: number; reason: string }) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 5000)
    throw new ApiError("Credit must be between Rs 1 and Rs 5,000. Ask an admin for more.");
  const c = find(customers, (x) => x.id === id, "Customer");
  c.credit += amount;
  c.creditHistory.unshift({
    id: `CH-${c.creditHistory.length + 1}`,
    at: simNow(),
    amount,
    reason,
    by: ME.name,
  });
  audit({
    action: `Issued ${formatRs(amount)} Kadé credit`,
    recordType: "customer",
    recordId: id,
    detail: reason,
  });
  return respond(view(c));
}

export async function resolveFlag({
  customerId,
  flagId,
  outcome,
  note,
}: {
  customerId: string;
  flagId: string;
  outcome: "cleared" | "actioned";
  note: string;
}) {
  const c = find(customers, (x) => x.id === customerId, "Customer");
  const f = find(c.flags, (x) => x.id === flagId, "Flag");
  f.status = outcome;
  f.resolution = `${note || (outcome === "cleared" ? "Looked genuine" : "Action taken")}. ${outcome === "cleared" ? "Cleared" : "Actioned"} by ${ME.short}.`;
  audit({
    action: outcome === "cleared" ? "Cleared fraud flag" : "Actioned fraud flag",
    recordType: "customer",
    recordId: customerId,
    detail: note,
  });
  return respond(view(c));
}

export async function setBlocked({ id, blocked, reason }: { id: string; blocked: boolean; reason: string }) {
  const c = find(customers, (x) => x.id === id, "Customer");
  c.blocked = blocked;
  c.blockReason = blocked ? reason : undefined;
  if (blocked)
    c.flags.forEach(
      (f) => f.status === "open" && ((f.status = "actioned"), (f.resolution = `Blocked by ${ME.short}`)),
    );
  audit({
    action: blocked ? "Blocked customer" : "Unblocked customer",
    recordType: "customer",
    recordId: id,
    detail: reason,
  });
  return respond(view(c));
}
