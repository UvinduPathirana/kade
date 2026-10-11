import { Inject, Injectable } from "@nestjs/common";
import { PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import {
  MessageAuthorKind,
  ReplyToTicketRequest,
  ReplyToTicketResponse,
  RequesterKind,
  ResolutionKind,
  ResolveTicketRequest,
  ResolveTicketResponse,
  TicketAdminServiceService,
  TicketPriority,
  TicketStatus,
  type AssignTicketRequest,
  type AssignTicketResponse,
  type GetTicketRequest,
  type GetTicketResponse,
  type ListMacrosResponse,
  type ListTicketsRequest,
  type ListTicketsResponse,
  type ReopenTicketRequest,
  type ReopenTicketResponse,
  type SetTicketPriorityRequest,
  type SetTicketPriorityResponse,
} from "@kade/proto/kade/support/v1/support_service";
import { v7 as uuidv7 } from "uuid";
import type { StoredResolution } from "../db/schema.js";
import { Database, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { toTicket } from "./mapping.js";
import { formatRs, MAX_CREDIT_MINOR, MAX_MESSAGE, MAX_NOTE, slaDue } from "./rules.js";
import { shortName, staffName } from "./staff.js";
import { parseOffset, STAFF_ROLES } from "./support.grpc.js";
import { TicketEvents } from "./ticket-events.js";
import { TicketsRepository, type TicketRow } from "./tickets.repository.js";
import { Upstream } from "./upstream.js";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** kade.support.v1.TicketAdminService: the admin console's support desk (support, ops, admin). */
@GrpcService(TicketAdminServiceService)
@Injectable()
export class TicketAdminGrpcService implements GrpcHandlers<TicketAdminServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(TicketsRepository) private readonly repo: TicketsRepository,
    @Inject(TicketEvents) private readonly events: TicketEvents,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(Upstream) private readonly upstream: Upstream,
  ) {}

  async listTickets(request: ListTicketsRequest, ctx: RequestContext): Promise<ListTicketsResponse> {
    ctx.requireRole(...STAFF_ROLES);
    const offset = parseOffset(request.page?.pageToken);
    const limit = Math.min(Math.max(request.page?.pageSize || DEFAULT_PAGE, 1), MAX_PAGE);
    const { rows, total } = await this.repo.listTickets(
      this.database.db,
      {
        status: request.status,
        category: request.category,
        priority: request.priority,
        assigneeId: request.assigneeId || undefined,
        unassignedOnly: request.unassignedOnly,
        slaBreachedOnly: request.slaBreachedOnly,
        orderId: request.orderId || undefined,
        requesterId: request.requesterId || undefined,
      },
      new Date(),
      offset,
      limit,
    );
    return {
      tickets: rows.map((r) => toTicket(r)),
      page: {
        nextPageToken: offset + rows.length < total ? String(offset + rows.length) : "",
        totalSize: total,
      },
    };
  }

  async getTicket(request: GetTicketRequest, ctx: RequestContext): Promise<GetTicketResponse> {
    ctx.requireRole(...STAFF_ROLES);
    const ticket = await this.repo.findTicket(this.database.db, request.ticketId);
    if (!ticket) throw ticketNotFound();
    return { ticket: toTicket(ticket, await this.repo.messages(this.database.db, ticket.id)) };
  }

  async replyToTicket(request: ReplyToTicketRequest, ctx: RequestContext): Promise<ReplyToTicketResponse> {
    ctx.requireRole(...STAFF_ROLES);
    const body = request.body.trim();
    if (!body) throw invalidArgument("REPLY_REQUIRED", "Write a reply before sending.", { field: "body" });
    if (body.length > MAX_MESSAGE)
      throw invalidArgument("REPLY_TOO_LONG", "Keep replies under 2,000 characters.");
    const agentId = request.agentId || ctx.userId || "";
    const agentName = staffName(agentId, request.agentName);
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `ReplyToTicket:${agentId}`,
          key: request.idempotencyKey,
          request: ReplyToTicketRequest.encode(request).finish(),
          codec: ReplyToTicketResponse,
        },
        async () => {
          let ticket = await this.lock(tx, request.ticketId);
          const now = new Date();
          const set: Partial<TicketRow> = { updatedAt: now, firstResponseAt: ticket.firstResponseAt ?? now };
          // Answered: waiting on the requester now (admin console: open → pending).
          if (ticket.status === TicketStatus.TICKET_STATUS_OPEN)
            set.status = TicketStatus.TICKET_STATUS_PENDING;
          const claim = !ticket.assigneeId && Boolean(agentId);
          if (claim) Object.assign(set, { assigneeId: agentId, assigneeName: agentName });
          ticket = await this.repo.updateTicket(tx, ticket.id, set);
          const message = await this.repo.insertMessage(tx, {
            id: uuidv7(),
            ticketId: ticket.id,
            at: now,
            fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_AGENT,
            author: agentName,
            body,
          });
          await this.events.messageAdded(tx, ticket, message);
          if (claim) await this.events.assigned(tx, ticket, now);
          return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
        },
      ),
    );
  }

  async assignTicket(request: AssignTicketRequest, ctx: RequestContext): Promise<AssignTicketResponse> {
    ctx.requireRole(...STAFF_ROLES);
    const by = shortName(staffName(ctx.userId));
    return this.database.transaction(ctx, async (tx) => {
      let ticket = await this.lock(tx, request.ticketId);
      const now = new Date();
      const assigneeId = request.assigneeId || null;
      const assigneeName = assigneeId ? staffName(assigneeId) : null;
      if (ticket.assigneeId === assigneeId) {
        return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
      }
      ticket = await this.repo.updateTicket(tx, ticket.id, { assigneeId, assigneeName, updatedAt: now });
      await this.system(
        tx,
        ticket,
        now,
        assigneeName ? `Assigned to ${assigneeName} by ${by}.` : `Unassigned by ${by}.`,
      );
      await this.events.assigned(tx, ticket, now);
      return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
    });
  }

  async setTicketPriority(
    request: SetTicketPriorityRequest,
    ctx: RequestContext,
  ): Promise<SetTicketPriorityResponse> {
    ctx.requireRole(...STAFF_ROLES);
    if (!request.priority || !(request.priority in TicketPriority) || request.priority < 0) {
      throw invalidArgument("PRIORITY_REQUIRED", "Pick a priority.", { field: "priority" });
    }
    return this.database.transaction(ctx, async (tx) => {
      let ticket = await this.lock(tx, request.ticketId);
      const now = new Date();
      const due = slaDue(ticket.openedAt, request.priority);
      ticket = await this.repo.updateTicket(tx, ticket.id, {
        priority: request.priority,
        slaDueAt: due,
        // A later deadline re-arms the breach alert.
        slaBreachedAt: due > now ? null : ticket.slaBreachedAt,
        updatedAt: now,
      });
      await this.events.priorityChanged(tx, ticket, now);
      return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
    });
  }

  async resolveTicket(request: ResolveTicketRequest, ctx: RequestContext): Promise<ResolveTicketResponse> {
    ctx.requireRole(...STAFF_ROLES);
    const agentId = request.agentId || ctx.userId || "";
    const agentName = staffName(agentId, request.agentName);
    const note = request.note.trim();
    if (note.length > MAX_NOTE)
      throw invalidArgument("NOTE_TOO_LONG", "Keep the note under 1,000 characters.");
    const kind = request.kind || ResolutionKind.RESOLUTION_KIND_NONE;
    const amount = request.amount?.amountMinor ?? 0;

    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `ResolveTicket:${request.ticketId}`,
          key: request.idempotencyKey,
          request: ResolveTicketRequest.encode(request).finish(),
          codec: ResolveTicketResponse,
        },
        async () => {
          let ticket = await this.lock(tx, request.ticketId);
          if (ticket.status === TicketStatus.TICKET_STATUS_RESOLVED) {
            throw failedPrecondition(
              "TICKET_ALREADY_RESOLVED",
              "This ticket is already resolved. Reopen it first.",
            );
          }
          const now = new Date();
          // Retries of the same resolution reuse the upstream key, so money moves at most once.
          const upstreamKey = request.idempotencyKey
            ? `ticket:${ticket.id}:${request.idempotencyKey}`
            : `ticket:${ticket.id}:resolve:${ticket.updatedAt.getTime()}`;
          let summary = "Resolved without compensation";
          let externalRef = "";
          let method = RefundMethod.REFUND_METHOD_UNSPECIFIED;

          if (kind === ResolutionKind.RESOLUTION_KIND_REFUND) {
            if (!ticket.orderId) {
              throw failedPrecondition(
                "TICKET_HAS_NO_ORDER",
                "This ticket has no linked order to refund. Issue Kadé credit instead.",
              );
            }
            if (amount <= 0)
              throw invalidArgument("AMOUNT_INVALID", "Refund at least Rs 1.", { field: "amount" });
            method = request.method || RefundMethod.REFUND_METHOD_CREDIT;
            const order = await this.upstream.getOrder(ticket.orderId, ctx);
            const left = (order.totals?.total?.amountMinor ?? 0) - (order.refunded?.amountMinor ?? 0);
            if (amount > left) {
              throw failedPrecondition(
                "REFUND_EXCEEDS_REMAINING",
                `Refund between Rs 1 and ${formatRs(left)}, the amount not yet refunded on ${order.orderNumber}.`,
              );
            }
            if (
              method === RefundMethod.REFUND_METHOD_CARD &&
              order.payment?.kind !== PaymentMethodKind.PAYMENT_METHOD_KIND_CARD
            ) {
              throw failedPrecondition(
                "CASH_ORDER_REFUND_TO_CREDIT",
                `${order.orderNumber} was paid in cash. Refund it as Kadé credit.`,
              );
            }
            const { refund } = await this.upstream.refundOrder(
              {
                orderId: ticket.orderId,
                amount: { amountMinor: amount, currency: "LKR" },
                method,
                reason: note || ticket.subject,
                by: agentName,
                ticketId: ticket.id,
                idempotencyKey: upstreamKey,
              },
              ctx,
            );
            externalRef = refund?.id ?? "";
            summary = `Refunded ${formatRs(amount)} to ${method === RefundMethod.REFUND_METHOD_CARD ? "card" : "Kadé credit"}`;
            await this.repo.updateIssueByTicket(tx, ticket.id, { refundId: externalRef });
          } else if (kind === ResolutionKind.RESOLUTION_KIND_CREDIT) {
            if (amount <= 0 || amount > MAX_CREDIT_MINOR) {
              throw invalidArgument("CREDIT_AMOUNT_INVALID", "Credit must be between Rs 1 and Rs 5,000.", {
                field: "amount",
              });
            }
            if (ticket.requesterKind !== RequesterKind.REQUESTER_KIND_CUSTOMER) {
              throw failedPrecondition(
                "CREDIT_CUSTOMERS_ONLY",
                "Credit can only go to a customer. Use a refund or a rider adjustment instead.",
              );
            }
            const entry = await this.upstream.addGoodwillCredit(
              {
                customerId: ticket.requesterId,
                amountMinor: amount,
                label: `Ticket: ${ticket.subject}`,
                ticketId: ticket.id,
                by: agentName,
                idempotencyKey: upstreamKey,
              },
              ctx,
            );
            externalRef = entry?.id ?? "";
            summary = `Issued ${formatRs(amount)} Kadé credit`;
          }

          const resolution: StoredResolution = {
            kind,
            amountMinor: kind === ResolutionKind.RESOLUTION_KIND_NONE ? 0 : amount,
            method,
            summary,
            note,
            externalRef,
            resolvedBy: agentName,
            resolvedAt: now.toISOString(),
          };
          ticket = await this.repo.updateTicket(tx, ticket.id, {
            status: TicketStatus.TICKET_STATUS_RESOLVED,
            resolution,
            updatedAt: now,
            assigneeId: ticket.assigneeId ?? (agentId || null),
            assigneeName: ticket.assigneeName ?? (agentId ? agentName : null),
          });
          await this.system(
            tx,
            ticket,
            now,
            `Resolved by ${shortName(agentName)}: ${note ? `${summary}. ${note}` : summary}`,
          );
          await this.events.resolved(tx, ticket, ctx, now);
          return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
        },
      ),
    );
  }

  async reopenTicket(request: ReopenTicketRequest, ctx: RequestContext): Promise<ReopenTicketResponse> {
    ctx.requireRole(...STAFF_ROLES);
    const by = shortName(staffName(ctx.userId, request.agentName));
    return this.database.transaction(ctx, async (tx) => {
      let ticket = await this.lock(tx, request.ticketId);
      if (ticket.status !== TicketStatus.TICKET_STATUS_RESOLVED) {
        return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
      }
      const now = new Date();
      // The resolution stays on the record (money already moved); status says it's open again.
      ticket = await this.repo.updateTicket(tx, ticket.id, {
        status: TicketStatus.TICKET_STATUS_OPEN,
        updatedAt: now,
      });
      await this.system(tx, ticket, now, `Reopened by ${by}.`);
      await this.events.reopened(tx, ticket, ctx, now);
      return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
    });
  }

  async listMacros(_request: unknown, ctx: RequestContext): Promise<ListMacrosResponse> {
    ctx.requireRole(...STAFF_ROLES);
    return {
      macros: (await this.repo.macros(this.database.db)).map(({ id, title, body }) => ({ id, title, body })),
    };
  }

  private async lock(tx: Tx, ticketId: string): Promise<TicketRow> {
    const ticket = await this.repo.lockTicket(tx, ticketId);
    if (!ticket) throw ticketNotFound();
    return ticket;
  }

  private async system(tx: Tx, ticket: TicketRow, at: Date, body: string): Promise<void> {
    const message = await this.repo.insertMessage(tx, {
      id: uuidv7(),
      ticketId: ticket.id,
      at,
      fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_SYSTEM,
      author: "Kadé",
      body,
    });
    await this.events.messageAdded(tx, ticket, message);
  }
}

function ticketNotFound() {
  return notFound("TICKET_NOT_FOUND", "We couldn't find that ticket.");
}
