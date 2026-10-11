import type {
  OrderIssue,
  Requester,
  Ticket,
  TicketMessage,
  TicketResolution,
} from "@kade/proto/kade/support/v1/support_service";
import type { StoredResolution } from "../db/schema.js";
import type { IssueRow, MessageRow, TicketRow } from "./tickets.repository.js";

export function requesterOf(row: TicketRow): Requester {
  return { kind: row.requesterKind, id: row.requesterId, name: row.requesterName };
}

export function toResolution(r: StoredResolution | null | undefined): TicketResolution | undefined {
  if (!r) return undefined;
  return {
    kind: r.kind,
    amount: r.amountMinor ? { amountMinor: r.amountMinor, currency: "LKR" } : undefined,
    method: r.method,
    summary: r.summary,
    note: r.note,
    externalRef: r.externalRef,
    resolvedBy: r.resolvedBy,
    resolvedAt: new Date(r.resolvedAt),
  };
}

export function toMessage(row: MessageRow): TicketMessage {
  const o = row.attachedOrder;
  return {
    id: row.id,
    ticketId: row.ticketId,
    at: row.at,
    from: row.fromKind,
    author: row.author,
    body: row.body,
    order: o
      ? {
          orderId: o.orderId,
          orderNumber: o.orderNumber,
          restaurantName: o.restaurantName,
          total: { amountMinor: o.totalMinor, currency: "LKR" },
        }
      : undefined,
  };
}

export function toTicket(row: TicketRow, messages: MessageRow[] = []): Ticket {
  return {
    id: row.id,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    requester: requesterOf(row),
    orderId: row.orderId ?? "",
    orderNumber: row.orderNumber ?? "",
    channel: row.channel,
    openedAt: row.openedAt,
    slaDueAt: row.slaDueAt,
    firstResponseAt: row.firstResponseAt ?? undefined,
    assigneeId: row.assigneeId ?? "",
    assigneeName: row.assigneeName ?? "",
    status: row.status,
    resolution: toResolution(row.resolution),
    messages: messages.map(toMessage),
    updatedAt: row.updatedAt,
  };
}

export function toIssue(row: IssueRow): OrderIssue {
  return {
    orderId: row.orderId,
    ticketId: row.ticketId,
    kind: row.kind,
    lines: row.lines,
    note: row.note,
    photoRef: row.photoRef,
    photoName: row.photoName,
    resolution: row.resolution,
    amount: { amountMinor: row.amountMinor, currency: "LKR" },
    reportedAt: row.reportedAt,
    refundId: row.refundId,
  };
}
