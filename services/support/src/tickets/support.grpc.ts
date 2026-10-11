import { Inject, Injectable } from "@nestjs/common";
import { PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import { OrderStatus, type Order } from "@kade/proto/kade/order/v1/order_service";
import {
  HelpAudience,
  IssueKind,
  IssueResolution,
  MessageAuthorKind,
  ReportOrderIssueRequest,
  ReportOrderIssueResponse,
  RequesterKind,
  ResolutionKind,
  SendMessageRequest,
  SendMessageResponse,
  SupportServiceService,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  type AttachedOrder,
  type BatchGetOrderIssuesRequest,
  type BatchGetOrderIssuesResponse,
  type GetOrStartConversationRequest,
  type GetOrStartConversationResponse,
  type ListHelpTopicsRequest,
  type ListHelpTopicsResponse,
  type ListMessagesRequest,
  type ListMessagesResponse,
  type PreviewOrderIssueRequest,
  type PreviewOrderIssueResponse,
  type Requester,
} from "@kade/proto/kade/support/v1/support_service";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { StoredAttachedOrder } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument, notFound, permissionDenied } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { toIssue, toMessage, toTicket } from "./mapping.js";
import {
  formatRs,
  greeting,
  HELP_TOPICS,
  ISSUE_CATEGORY,
  ISSUE_PRIORITY,
  issueAmount,
  issueMessage,
  issueSubject,
  MAX_MESSAGE,
  MAX_NOTE,
  slaDue,
  SUPPORT_AGENT,
  SUPPORT_PHONE,
} from "./rules.js";
import { TicketEvents } from "./ticket-events.js";
import { TicketsRepository, type MessageRow, type TicketRow } from "./tickets.repository.js";
import { Upstream } from "./upstream.js";

export const STAFF_ROLES = ["support", "ops", "admin"];
const MAX_BATCH = 100;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;
const LINE_KINDS = new Set([
  IssueKind.ISSUE_KIND_MISSING,
  IssueKind.ISSUE_KIND_WRONG,
  IssueKind.ISSUE_KIND_SPILLED,
]);

/** kade.support.v1.SupportService: customer and rider apps (order issues, chat, help topics). */
@GrpcService(SupportServiceService)
@Injectable()
export class SupportGrpcService implements GrpcHandlers<SupportServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(TicketsRepository) private readonly repo: TicketsRepository,
    @Inject(TicketEvents) private readonly events: TicketEvents,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(Upstream) private readonly upstream: Upstream,
  ) {}

  async previewOrderIssue(
    request: PreviewOrderIssueRequest,
    ctx: RequestContext,
  ): Promise<PreviewOrderIssueResponse> {
    validateIssueKind(request.kind);
    const order = await this.upstream.getOrder(request.orderId, ctx);
    assertOwnOrder(order, ctx);
    return { amount: { amountMinor: issueAmount(order, request.kind, request.lines), currency: "LKR" } };
  }

  async reportOrderIssue(
    request: ReportOrderIssueRequest,
    ctx: RequestContext,
  ): Promise<ReportOrderIssueResponse> {
    validateIssueKind(request.kind);
    const note = request.note.trim();
    if (note.length > MAX_NOTE)
      throw invalidArgument("NOTE_TOO_LONG", "Keep the note under 1,000 characters.");
    if (LINE_KINDS.has(request.kind) && !request.lines.some((l) => l.quantity > 0)) {
      throw invalidArgument("ISSUE_LINES_REQUIRED", "Choose the dishes that were affected.", {
        field: "lines",
      });
    }
    if (request.kind === IssueKind.ISSUE_KIND_CHARGED && !note) {
      throw invalidArgument(
        "ISSUE_NOTE_REQUIRED",
        "Tell us what looks wrong with the charge so the payments team can check it.",
        { field: "note" },
      );
    }
    // Wrong charges always go to a person; otherwise the customer's choice (default: an agent looks).
    const resolution =
      request.kind === IssueKind.ISSUE_KIND_CHARGED || !request.resolution
        ? IssueResolution.ISSUE_RESOLUTION_REVIEW
        : request.resolution;

    const order = await this.upstream.getOrder(request.orderId, ctx);
    const customerId = request.customerId || ctx.userId || order.customer?.id || "";
    assertOwnOrder(order, ctx, customerId);
    const arrived =
      order.status === OrderStatus.ORDER_STATUS_DELIVERED ||
      order.status === OrderStatus.ORDER_STATUS_COLLECTED;
    if (request.kind !== IssueKind.ISSUE_KIND_CHARGED && !arrived) {
      throw failedPrecondition("ORDER_NOT_ARRIVED", "You can report a problem once the order has arrived.");
    }
    const card = order.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CARD;
    if (resolution === IssueResolution.ISSUE_RESOLUTION_CARD && !card) {
      throw failedPrecondition(
        "CASH_ORDER_REFUND_TO_CREDIT",
        "This order was paid in cash, so the refund can only go to your Kadé credit.",
      );
    }
    const amount = issueAmount(order, request.kind, request.lines);

    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `ReportOrderIssue:${customerId}`,
          key: request.idempotencyKey,
          request: ReportOrderIssueRequest.encode(request).finish(),
          codec: ReportOrderIssueResponse,
        },
        async () => {
          if (await this.repo.findIssue(tx, order.id)) throw alreadyReported();
          const now = new Date();
          const priority = ISSUE_PRIORITY[request.kind] ?? TicketPriority.TICKET_PRIORITY_NORMAL;
          const requester: Requester = {
            kind: RequesterKind.REQUESTER_KIND_CUSTOMER,
            id: customerId,
            name: order.customer?.name ?? "",
          };
          let ticket = await this.repo.insertTicket(tx, {
            id: uuidv7(),
            subject: issueSubject(request.kind, order.orderNumber),
            category: ISSUE_CATEGORY[request.kind] ?? TicketCategory.TICKET_CATEGORY_GENERAL,
            priority,
            requesterKind: requester.kind,
            requesterId: requester.id,
            requesterName: requester.name,
            orderId: order.id,
            orderNumber: order.orderNumber,
            channel: TicketChannel.TICKET_CHANNEL_ISSUE_REPORT,
            status: TicketStatus.TICKET_STATUS_OPEN,
            openedAt: now,
            slaDueAt: slaDue(now, priority),
            updatedAt: now,
          });
          const first = await this.repo.insertMessage(tx, {
            id: uuidv7(),
            ticketId: ticket.id,
            at: now,
            fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER,
            author: requester.name || "Customer",
            body: issueMessage(order, request.kind, request.lines, note),
            attachedOrder: attachedFrom(order),
          });
          const issue = await this.repo.insertIssue(tx, {
            orderId: order.id,
            ticketId: ticket.id,
            customerId,
            kind: request.kind,
            lines: request.lines.filter((l) => l.quantity > 0),
            note,
            photoRef: request.photoRef,
            photoName: request.photoName,
            resolution,
            amountMinor: amount,
            reportedAt: now,
          });
          if (!issue) throw alreadyReported(); // lost a race with a concurrent report
          await this.events.opened(tx, ticket, first, now);
          await this.events.issueReported(tx, issue, now);

          const messages: MessageRow[] = [first];
          let refundId = "";
          if (resolution !== IssueResolution.ISSUE_RESOLUTION_REVIEW && amount > 0) {
            // Inside the transaction: if the refund fails, nothing about the report is kept and the
            // customer sees order's reason (or ORDER_SERVICE_UNAVAILABLE). Retries reuse the key.
            const method =
              resolution === IssueResolution.ISSUE_RESOLUTION_CARD
                ? RefundMethod.REFUND_METHOD_CARD
                : RefundMethod.REFUND_METHOD_CREDIT;
            const { refund } = await this.upstream.refundOrder({
              orderId: order.id,
              amount: { amountMinor: amount, currency: "LKR" },
              method,
              reason: ticket.subject,
              by: "Kadé",
              ticketId: ticket.id,
              idempotencyKey: `issue:${order.id}`,
            });
            refundId = refund?.id ?? "";
            const where = method === RefundMethod.REFUND_METHOD_CARD ? "your card" : "your Kadé credit";
            const summary = `Refunded ${formatRs(amount)} to ${method === RefundMethod.REFUND_METHOD_CARD ? "card" : "Kadé credit"}`;
            await this.repo.updateIssueByTicket(tx, ticket.id, { refundId });
            ticket = await this.repo.updateTicket(tx, ticket.id, {
              status: TicketStatus.TICKET_STATUS_RESOLVED,
              resolution: {
                kind: ResolutionKind.RESOLUTION_KIND_REFUND,
                amountMinor: amount,
                method,
                summary,
                note: "Paid automatically from the order's issue report.",
                externalRef: refundId,
                resolvedBy: "Kadé",
                resolvedAt: now.toISOString(),
              },
              updatedAt: now,
            });
            messages.push(
              await this.repo.insertMessage(tx, {
                id: uuidv7(),
                ticketId: ticket.id,
                at: now,
                fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_SYSTEM,
                author: "Kadé",
                body: `${formatRs(amount)} is on its way back to ${where}. ${
                  method === RefundMethod.REFUND_METHOD_CARD
                    ? "Card refunds take 5 to 7 working days to show."
                    : "It's ready to use now."
                }`,
              }),
            );
            await this.events.resolved(tx, ticket, ctx, now);
          }
          return { issue: toIssue({ ...issue, refundId }), ticket: toTicket(ticket, messages) };
        },
      ),
    );
  }

  async batchGetOrderIssues(request: BatchGetOrderIssuesRequest): Promise<BatchGetOrderIssuesResponse> {
    if (request.orderIds.length > MAX_BATCH) {
      throw invalidArgument("TOO_MANY_IDS", `Ask for at most ${MAX_BATCH} orders at a time.`, {
        field: "order_ids",
      });
    }
    return {
      issues: (await this.repo.issues(this.database.db, [...new Set(request.orderIds)])).map(toIssue),
    };
  }

  async getOrStartConversation(
    request: GetOrStartConversationRequest,
    ctx: RequestContext,
  ): Promise<GetOrStartConversationResponse> {
    const requester = resolveRequester(request.requester, ctx);
    const order = request.orderId ? await this.upstream.findOrder(request.orderId, ctx) : undefined;
    return this.database.transaction(ctx, async (tx) => {
      // Serialise per requester so two app tabs opening support don't create two chats.
      await tx.execute(sqlLock(requester.id));
      let ticket = await this.repo.openChat(tx, requester.id);
      const now = new Date();
      if (!ticket) {
        const priority =
          requester.kind === RequesterKind.REQUESTER_KIND_RIDER
            ? TicketPriority.TICKET_PRIORITY_HIGH
            : TicketPriority.TICKET_PRIORITY_NORMAL;
        ticket = await this.repo.insertTicket(tx, {
          id: uuidv7(),
          subject: order ? `Help with ${order.orderNumber}` : chatSubject(requester.kind),
          category: categoryFor(requester.kind, Boolean(request.orderId)),
          priority,
          requesterKind: requester.kind,
          requesterId: requester.id,
          requesterName: requester.name,
          orderId: request.orderId || null,
          orderNumber: order?.orderNumber ?? null,
          channel: TicketChannel.TICKET_CHANNEL_CHAT,
          status: TicketStatus.TICKET_STATUS_OPEN,
          openedAt: now,
          slaDueAt: slaDue(now, priority),
          updatedAt: now,
        });
        const hello = await this.repo.insertMessage(tx, {
          id: uuidv7(),
          ticketId: ticket.id,
          at: now,
          fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_AGENT,
          author: SUPPORT_AGENT,
          body: greeting(requester.kind, requester.name),
        });
        await this.events.opened(tx, ticket, hello, now);
      } else if (request.orderId && !ticket.orderId) {
        ticket = await this.repo.updateTicket(tx, ticket.id, {
          orderId: request.orderId,
          orderNumber: order?.orderNumber ?? null,
          updatedAt: now,
        });
      }
      return { ticket: toTicket(ticket, await this.repo.messages(tx, ticket.id)) };
    });
  }

  async sendMessage(request: SendMessageRequest, ctx: RequestContext): Promise<SendMessageResponse> {
    const requester = resolveRequester(request.requester, ctx);
    const text = request.text.trim();
    if (!text && !request.order?.orderId) {
      throw invalidArgument("MESSAGE_REQUIRED", "Write a message before sending.", { field: "text" });
    }
    if (text.length > MAX_MESSAGE) {
      throw invalidArgument("MESSAGE_TOO_LONG", "Keep messages under 2,000 characters.", { field: "text" });
    }
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `SendMessage:${requester.id}`,
          key: request.idempotencyKey,
          request: SendMessageRequest.encode(request).finish(),
          codec: SendMessageResponse,
        },
        async () => {
          let ticket = await this.repo.lockTicket(tx, request.ticketId);
          if (!ticket || ticket.requesterId !== requester.id) {
            throw notFound("TICKET_NOT_FOUND", "We couldn't find that conversation.");
          }
          const now = new Date();
          const attached = request.order?.orderId ? attachedFromMessage(request.order) : null;
          const set: Partial<TicketRow> = { updatedAt: now };
          if (ticket.status !== TicketStatus.TICKET_STATUS_OPEN) set.status = TicketStatus.TICKET_STATUS_OPEN;
          if (attached && !ticket.orderId) {
            set.orderId = attached.orderId;
            set.orderNumber = attached.orderNumber;
          }
          const reopened = ticket.status === TicketStatus.TICKET_STATUS_RESOLVED;
          if (reopened) set.resolution = null;
          ticket = await this.repo.updateTicket(tx, ticket.id, set);
          if (reopened) await this.events.reopened(tx, ticket, ctx, now);

          const firstFromRequester =
            (await this.repo.countFrom(tx, ticket.id, MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER)) === 0;
          const message = await this.repo.insertMessage(tx, {
            id: uuidv7(),
            ticketId: ticket.id,
            at: now,
            fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER,
            author: requester.name || ticket.requesterName,
            body: text,
            attachedOrder: attached,
          });
          await this.events.messageAdded(tx, ticket, message);
          if (firstFromRequester && !ticket.firstResponseAt) {
            const ack = await this.repo.insertMessage(tx, {
              id: uuidv7(),
              ticketId: ticket.id,
              at: new Date(now.getTime() + 1),
              fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_SYSTEM,
              author: "Kadé",
              body: "Thanks. Someone from the support team will reply here, usually within a few minutes.",
            });
            await this.events.messageAdded(tx, ticket, ack);
          }
          return { message: toMessage(message) };
        },
      ),
    );
  }

  async listMessages(request: ListMessagesRequest, ctx: RequestContext): Promise<ListMessagesResponse> {
    const ticket = await this.repo.findTicket(this.database.db, request.ticketId);
    const staff = STAFF_ROLES.some((r) => ctx.hasRole(r));
    const own =
      ticket &&
      (ticket.requesterKind !== RequesterKind.REQUESTER_KIND_CUSTOMER ||
        !ctx.userId ||
        ticket.requesterId === ctx.userId);
    if (!ticket || (!staff && !own))
      throw notFound("TICKET_NOT_FOUND", "We couldn't find that conversation.");
    const offset = parseOffset(request.page?.pageToken);
    const limit = Math.min(Math.max(request.page?.pageSize || DEFAULT_PAGE, 1), MAX_PAGE);
    const [rows, total] = await Promise.all([
      this.repo.messages(this.database.db, ticket.id, offset, limit),
      this.repo.countMessages(this.database.db, ticket.id),
    ]);
    return {
      messages: rows.map(toMessage),
      page: {
        nextPageToken: offset + rows.length < total ? String(offset + rows.length) : "",
        totalSize: total,
      },
    };
  }

  async listHelpTopics(request: ListHelpTopicsRequest): Promise<ListHelpTopicsResponse> {
    const audience = request.audience || HelpAudience.HELP_AUDIENCE_CUSTOMER;
    return { topics: HELP_TOPICS[audience] ?? [], supportPhone: SUPPORT_PHONE };
  }
}

function validateIssueKind(kind: IssueKind): void {
  if (!kind || !(kind in ISSUE_CATEGORY)) {
    throw invalidArgument("ISSUE_KIND_REQUIRED", "Tell us what went wrong.", { field: "kind" });
  }
}

/** Customers may only touch their own orders; staff can act for anyone. */
function assertOwnOrder(order: Order, ctx: RequestContext, customerId?: string): void {
  if (STAFF_ROLES.some((r) => ctx.hasRole(r)) || !order.customer?.id) return;
  // Without identity metadata the call is internal (trusted network); otherwise both the caller and
  // the customer named in the request must own the order.
  for (const who of [ctx.userId, customerId]) {
    if (who && who !== order.customer.id) {
      throw permissionDenied("NOT_YOUR_ORDER", "You can only get help with your own orders.");
    }
  }
}

function alreadyReported() {
  return failedPrecondition(
    "ISSUE_ALREADY_REPORTED",
    "You've already reported a problem with this order. Chat with us if something else is wrong.",
  );
}

/**
 * The requester as the gateway set it. Customers are their Keycloak sub, so the id must match the
 * caller; riders and restaurants are addressed by rider / outlet id, which the gateway resolved.
 */
function resolveRequester(requester: Requester | undefined, ctx: RequestContext): Requester {
  const kind = requester?.kind || RequesterKind.REQUESTER_KIND_CUSTOMER;
  const id = requester?.id || ctx.userId;
  if (!id)
    throw invalidArgument("REQUESTER_REQUIRED", "Sign in to chat with support.", { field: "requester" });
  if (
    kind === RequesterKind.REQUESTER_KIND_CUSTOMER &&
    ctx.userId &&
    ctx.userId !== id &&
    !STAFF_ROLES.some((r) => ctx.hasRole(r))
  ) {
    throw permissionDenied("PERMISSION_DENIED", "You can only see your own conversations.");
  }
  return { kind, id, name: requester?.name ?? "" };
}

function chatSubject(kind: RequesterKind): string {
  if (kind === RequesterKind.REQUESTER_KIND_RIDER) return "Rider support chat";
  if (kind === RequesterKind.REQUESTER_KIND_RESTAURANT) return "Partner support chat";
  return "Chat with Kadé support";
}

function categoryFor(kind: RequesterKind, hasOrder: boolean): TicketCategory {
  if (kind === RequesterKind.REQUESTER_KIND_RIDER) return TicketCategory.TICKET_CATEGORY_RIDER;
  if (kind === RequesterKind.REQUESTER_KIND_RESTAURANT) return TicketCategory.TICKET_CATEGORY_RESTAURANT;
  return hasOrder ? TicketCategory.TICKET_CATEGORY_GENERAL : TicketCategory.TICKET_CATEGORY_ACCOUNT;
}

export function attachedFrom(order: Order): StoredAttachedOrder {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantName: order.restaurant?.name ?? "",
    totalMinor: order.totals?.total?.amountMinor ?? 0,
  };
}

function attachedFromMessage(o: AttachedOrder): StoredAttachedOrder {
  return {
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    restaurantName: o.restaurantName,
    totalMinor: o.total?.amountMinor ?? 0,
  };
}

export function parseOffset(token: string | undefined): number {
  if (!token) return 0;
  const n = Number(token);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.", { field: "page.page_token" });
  }
  return n;
}

/** Transaction-scoped advisory lock on a requester id. */
function sqlLock(requesterId: string) {
  return sql`select pg_advisory_xact_lock(hashtext(${`support-chat:${requesterId}`}))`;
}
