import { Inject, Injectable } from "@nestjs/common";
import {
  OrderIssueReported,
  TicketAssigned,
  TicketMessageAdded,
  TicketOpened,
  TicketPriorityChanged,
  TicketReopened,
  TicketResolved,
  TicketSlaBreached,
} from "@kade/proto/kade/support/v1/support_events";
import type { Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";
import { requesterOf, toIssue, toMessage, toResolution, toTicket } from "./mapping.js";
import type { IssueRow, MessageRow, TicketRow } from "./tickets.repository.js";

const P = "kade.support.v1.";

/** kade.ticket.events through the outbox (aggregatetype "ticket", key = ticket id). */
@Injectable()
export class TicketEvents {
  constructor(@Inject(OutboxWriter) private readonly outbox: OutboxWriter) {}

  private append(tx: Tx, ticketId: string, name: string, payload: Uint8Array): Promise<string> {
    return this.outbox.append(tx, {
      aggregateType: "ticket",
      aggregateId: ticketId,
      type: `${P}${name}`,
      payload,
    });
  }

  opened(tx: Tx, ticket: TicketRow, first: MessageRow | undefined, at: Date) {
    return this.append(
      tx,
      ticket.id,
      "TicketOpened",
      TicketOpened.encode({
        ticketId: ticket.id,
        ticket: toTicket(ticket, first ? [first] : []),
        occurredAt: at,
      }).finish(),
    );
  }

  messageAdded(tx: Tx, ticket: TicketRow, message: MessageRow) {
    return this.append(
      tx,
      ticket.id,
      "TicketMessageAdded",
      TicketMessageAdded.encode({
        ticketId: ticket.id,
        requester: requesterOf(ticket),
        message: toMessage(message),
        occurredAt: message.at,
      }).finish(),
    );
  }

  assigned(tx: Tx, ticket: TicketRow, at: Date) {
    return this.append(
      tx,
      ticket.id,
      "TicketAssigned",
      TicketAssigned.encode({
        ticketId: ticket.id,
        assigneeId: ticket.assigneeId ?? "",
        assigneeName: ticket.assigneeName ?? "",
        occurredAt: at,
      }).finish(),
    );
  }

  priorityChanged(tx: Tx, ticket: TicketRow, at: Date) {
    return this.append(
      tx,
      ticket.id,
      "TicketPriorityChanged",
      TicketPriorityChanged.encode({
        ticketId: ticket.id,
        priority: ticket.priority,
        slaDueAt: ticket.slaDueAt,
        occurredAt: at,
      }).finish(),
    );
  }

  slaBreached(tx: Tx, ticket: TicketRow, at: Date) {
    return this.append(
      tx,
      ticket.id,
      "TicketSlaBreached",
      TicketSlaBreached.encode({
        ticketId: ticket.id,
        priority: ticket.priority,
        slaDueAt: ticket.slaDueAt,
        occurredAt: at,
      }).finish(),
    );
  }

  resolved(tx: Tx, ticket: TicketRow, ctx: RequestContext | undefined, at: Date) {
    return this.append(
      tx,
      ticket.id,
      "TicketResolved",
      TicketResolved.encode({
        ticketId: ticket.id,
        requester: requesterOf(ticket),
        orderId: ticket.orderId ?? "",
        resolution: toResolution(ticket.resolution),
        actor: actorOf(ctx),
        occurredAt: at,
      }).finish(),
    );
  }

  reopened(tx: Tx, ticket: TicketRow, ctx: RequestContext | undefined, at: Date) {
    return this.append(
      tx,
      ticket.id,
      "TicketReopened",
      TicketReopened.encode({ ticketId: ticket.id, actor: actorOf(ctx), occurredAt: at }).finish(),
    );
  }

  issueReported(tx: Tx, issue: IssueRow, at: Date) {
    return this.append(
      tx,
      issue.ticketId,
      "OrderIssueReported",
      OrderIssueReported.encode({
        ticketId: issue.ticketId,
        customerId: issue.customerId,
        issue: toIssue(issue),
        occurredAt: at,
      }).finish(),
    );
  }
}

function actorOf(ctx: RequestContext | undefined) {
  return ctx?.userId
    ? { userId: ctx.userId, roles: [...ctx.roles], outletId: ctx.outletId ?? "" }
    : undefined;
}
