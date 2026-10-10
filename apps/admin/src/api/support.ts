// Support tickets API. Later: the support service (tickets, conversations, SLAs, macros). Refunds and
// credit raised from a ticket go through the order and customer services like any other.
import { formatRs } from "@kade/ui";
import { ApiError, audit, find, ME, respond, simNow } from "./client";
import { macros, tickets } from "./mock/backOffice";
import { refunds } from "./mock/orders";
import { orders } from "./mock/orders";
import { customers, staff } from "./mock/partners";
import type { RefundMethod, Ticket, TicketPriority } from "./types";

export const listTickets = () => respond(tickets);
export const listMacros = () => respond(macros);
export const listStaffNames = () =>
  respond(staff.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name, role: s.role })));

const sla: Record<TicketPriority, number> = { urgent: 15, high: 60, normal: 240, low: 1440 };

function update(id: string, fn: (t: Ticket) => void) {
  const t = find(tickets, (x) => x.id === id, `Ticket ${id}`);
  fn(t);
  return respond(t);
}

export async function replyToTicket({ id, body }: { id: string; body: string }) {
  if (!body.trim()) throw new ApiError("Write a reply before sending.");
  return update(id, (t) => {
    t.messages.push({
      id: `m-${t.messages.length + 1}-${simNow()}`,
      at: simNow(),
      from: "agent",
      author: ME.name,
      body: body.trim(),
    });
    if (t.status === "open") t.status = "pending";
    t.assigneeId ??= "S-1";
  });
}

export async function assignTicket({ id, assigneeId }: { id: string; assigneeId: string | null }) {
  const who = staff.find((s) => s.id === assigneeId);
  audit({
    action: who ? `Assigned ticket to ${who.name}` : "Unassigned ticket",
    recordType: "ticket",
    recordId: id,
  });
  return update(id, (t) => {
    t.assigneeId = assigneeId ?? undefined;
    t.messages.push({
      id: `m-sys-${simNow()}`,
      at: simNow(),
      from: "system",
      author: "Kadé",
      body: who ? `Assigned to ${who.name} by ${ME.short}.` : `Unassigned by ${ME.short}.`,
    });
  });
}

export async function setTicketPriority({ id, priority }: { id: string; priority: TicketPriority }) {
  return update(id, (t) => {
    t.priority = priority;
    t.slaDueAt = t.openedAt + sla[priority] * 60_000;
  });
}

export type Resolution =
  | { kind: "refund"; amount: number; method: RefundMethod }
  | { kind: "credit"; amount: number }
  | { kind: "none" };

export async function resolveTicket({
  id,
  resolution,
  note,
}: {
  id: string;
  resolution: Resolution;
  note: string;
}) {
  const t = find(tickets, (x) => x.id === id, `Ticket ${id}`);
  const at = simNow();
  let summary = "Resolved without compensation";
  if (resolution.kind === "refund") {
    const o = orders.find((x) => x.id === t.orderId);
    if (!o) throw new ApiError("This ticket has no linked order to refund. Issue Kadé credit instead.");
    const left = o.total - o.refunded;
    if (resolution.amount <= 0 || resolution.amount > left)
      throw new ApiError(
        `Refund between Rs 1 and ${formatRs(left)}, the amount not yet refunded on ${o.id}.`,
      );
    if (resolution.method === "card" && o.payment !== "card")
      throw new ApiError(`${o.id} was paid in cash. Refund it as Kadé credit.`);
    o.refunded += resolution.amount;
    o.timeline.push({
      at,
      label: `Refunded ${formatRs(resolution.amount)} from ticket ${t.id}`,
      by: ME.name,
    });
    refunds.unshift({
      id: `RF-${7200 + refunds.length}`,
      at,
      orderId: o.id,
      customerId: o.customerId,
      amount: resolution.amount,
      method: resolution.method,
      reason: note || t.subject,
      by: ME.name,
    });
    if (resolution.method === "credit") {
      const c = customers.find((x) => x.id === o.customerId);
      if (c) c.credit += resolution.amount;
    }
    summary = `Refunded ${formatRs(resolution.amount)} to ${resolution.method === "card" ? "card" : "Kadé credit"}`;
  } else if (resolution.kind === "credit") {
    if (resolution.amount <= 0 || resolution.amount > 5000)
      throw new ApiError("Credit must be between Rs 1 and Rs 5,000.");
    const c = customers.find((x) => x.id === t.requester.id);
    if (!c)
      throw new ApiError("Credit can only go to a customer. Use a refund or a rider adjustment instead.");
    c.credit += resolution.amount;
    c.creditHistory.unshift({
      id: `CH-${c.creditHistory.length + 1}`,
      at,
      amount: resolution.amount,
      reason: `Ticket ${t.id}: ${t.subject}`,
      by: ME.name,
    });
    summary = `Issued ${formatRs(resolution.amount)} Kadé credit`;
  }
  t.status = "resolved";
  t.resolution = note ? `${summary}. ${note}` : summary;
  t.messages.push({
    id: `m-sys-${at}`,
    at,
    from: "system",
    author: "Kadé",
    body: `Resolved by ${ME.short}: ${t.resolution}`,
  });
  audit({
    action: "Resolved ticket",
    recordType: "ticket",
    recordId: id,
    detail: note ? `${summary}. ${note}` : summary,
  });
  return respond(t);
}

export async function reopenTicket(id: string) {
  return update(id, (t) => {
    t.status = "open";
    t.messages.push({
      id: `m-sys-${simNow()}`,
      at: simNow(),
      from: "system",
      author: "Kadé",
      body: `Reopened by ${ME.short}.`,
    });
  });
}
