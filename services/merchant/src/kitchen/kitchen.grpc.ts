import { Inject, Injectable } from "@nestjs/common";
import {
  AcceptOrderRequest,
  AcceptOrderResponse,
  HandOverOrderRequest,
  HandOverOrderResponse,
  KitchenServiceService,
  MarkOrderReadyRequest,
  MarkOrderReadyResponse,
  RejectOrderRequest,
  RejectOrderResponse,
  type GetTicketRequest,
  type GetTicketResponse,
  type ListTicketsRequest,
  type ListTicketsResponse,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { RejectionReason } from "@kade/proto/kade/order/v1/order_service";
import { rejectReason, type TicketStatusDb } from "../domain/enums.js";
import { actorOf, MerchantEvents } from "../domain/merchant-events.js";
import { MINUTE } from "../domain/values.js";
import { OutletAccess, type OutletCaller } from "../outlets/outlet-access.js";
import { Database, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import type { Codec } from "../platform/idempotency/idempotency.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { DemoBoard } from "../seed/demo-board.js";
import { toTicket } from "./ticket-mapper.js";
import { TicketsRepository, type TicketPatch, type TicketRow } from "./tickets.repository.js";

export const MIN_PREP_MINUTES = 1;
export const MAX_PREP_MINUTES = 120;
const DEFAULT_CLOSED_WITHIN_MINUTES = 60;
const MAX_CLOSED_WITHIN_MINUTES = 24 * 60;
const MAX_NOTE = 300;

/**
 * kade.merchant.v1.KitchenService: the kitchen board and the four kitchen decisions. Each decision is
 * one transaction: lock the ticket, check the state machine, update, append the Ticket* event (real
 * orders only; the demo board is local) and record the idempotency key.
 *
 *   new ──accept (before accept_by)──▶ preparing ──ready──▶ ready ──hand over──▶ picked_up
 *    └──reject──▶ rejected        └── accept_by passes ──▶ missed (TICKET_MISSED)
 */
@GrpcService(KitchenServiceService)
@Injectable()
export class KitchenGrpcService implements GrpcHandlers<KitchenServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OutletAccess) private readonly access: OutletAccess,
    @Inject(TicketsRepository) private readonly tickets: TicketsRepository,
    @Inject(MerchantEvents) private readonly events: MerchantEvents,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(DemoBoard) private readonly demo: DemoBoard,
  ) {}

  async listTickets(request: ListTicketsRequest, ctx: RequestContext): Promise<ListTicketsResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    const minutes =
      request.closedWithinMinutes > 0 ? request.closedWithinMinutes : DEFAULT_CLOSED_WITHIN_MINUTES;
    if (minutes > MAX_CLOSED_WITHIN_MINUTES) {
      throw invalidArgument("CLOSED_WITHIN_TOO_LONG", "Look back at most 24 hours.", {
        field: "closed_within_minutes",
      });
    }
    const now = new Date();
    await this.demo.ensureFresh(outlet.id, now);
    await this.tickets.expireMissed(this.database.db, now, outlet.id);
    const rows = await this.tickets.board(
      this.database.db,
      outlet.id,
      new Date(now.getTime() - minutes * MINUTE),
    );
    return { tickets: rows.map(toTicket) };
  }

  async getTicket(request: GetTicketRequest, ctx: RequestContext): Promise<GetTicketResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    await this.tickets.expireMissed(this.database.db, new Date(), outlet.id);
    const row = await this.tickets.find(this.database.db, request.orderId);
    if (!row || row.outletId !== outlet.id) throw ticketNotFound(request.orderId);
    return { ticket: toTicket(row) };
  }

  async acceptOrder(request: AcceptOrderRequest, ctx: RequestContext): Promise<AcceptOrderResponse> {
    const prep = request.prepMinutes;
    if (!Number.isInteger(prep) || prep < MIN_PREP_MINUTES || prep > MAX_PREP_MINUTES) {
      throw invalidArgument("PREP_MINUTES_INVALID", "Prep time must be between 1 and 120 minutes.", {
        field: "prep_minutes",
      });
    }
    const caller = await this.access.authorise(ctx, request.outletId);
    // Expire first, in its own transaction, so a late accept leaves the ticket visibly "missed".
    await this.tickets.expireMissed(this.database.db, new Date(), caller.outlet.id);

    return this.decide(
      ctx,
      caller,
      "AcceptOrder",
      request,
      AcceptOrderRequest,
      AcceptOrderResponse,
      async (tx, t, now) => {
        if (t.status === "missed" || (t.status === "new" && now > t.acceptBy)) throw ticketMissed(t);
        if (t.status === "preparing" || t.status === "ready" || t.status === "picked_up") {
          throw failedPrecondition(
            "TICKET_ALREADY_ACCEPTED",
            `Order #${t.ticketNumber} has already been accepted.`,
          );
        }
        if (t.status !== "new") throw ticketClosed(t);

        const prepMinutes = prep + caller.outlet.busyExtraMinutes;
        const readyBy = new Date(now.getTime() + prepMinutes * MINUTE);
        const patch: TicketPatch = {
          status: "preparing",
          acceptedAt: now,
          prepMinutes,
          readyBy,
          actedBy: ctx.userId ?? null,
        };
        if (t.source === "demo") Object.assign(patch, this.demo.riderOnAccept(t, readyBy));
        const row = await this.tickets.update(tx, t.orderId, patch);
        if (t.source === "order") {
          await this.events.ticketAccepted(tx, {
            outletId: t.outletId,
            orderId: t.orderId,
            orderNumber: t.orderNumber,
            prepMinutes,
            readyBy,
            actor: actorOf(ctx, t.outletId),
            occurredAt: now,
          });
        }
        return row;
      },
    );
  }

  async rejectOrder(request: RejectOrderRequest, ctx: RequestContext): Promise<RejectOrderResponse> {
    const reason = rejectReason.toDb(request.reason);
    if (!reason || request.reason === RejectionReason.REJECTION_REASON_TIMEOUT) {
      throw invalidArgument("REJECT_REASON_INVALID", "Choose why you can't take this order.", {
        field: "reason",
      });
    }
    const note = request.note.trim();
    if (note.length > MAX_NOTE) {
      throw invalidArgument("NOTE_TOO_LONG", `Keep the note under ${MAX_NOTE} characters.`, {
        field: "note",
      });
    }
    const caller = await this.access.authorise(ctx, request.outletId);
    await this.tickets.expireMissed(this.database.db, new Date(), caller.outlet.id);

    return this.decide(
      ctx,
      caller,
      "RejectOrder",
      request,
      RejectOrderRequest,
      RejectOrderResponse,
      async (tx, t, now) => {
        if (t.status === "missed" || (t.status === "new" && now > t.acceptBy)) throw ticketMissed(t);
        if (t.status !== "new") {
          throw failedPrecondition("TICKET_NOT_NEW", `Order #${t.ticketNumber} can't be rejected now.`, {
            status: t.status,
          });
        }
        const row = await this.tickets.update(tx, t.orderId, {
          status: "rejected",
          rejectReason: reason,
          rejectNote: note,
          closedAt: now,
          actedBy: ctx.userId ?? null,
        });
        if (t.source === "order") {
          await this.events.ticketRejected(tx, {
            outletId: t.outletId,
            orderId: t.orderId,
            orderNumber: t.orderNumber,
            reason: request.reason,
            note,
            actor: actorOf(ctx, t.outletId),
            occurredAt: now,
          });
        }
        return row;
      },
    );
  }

  async markOrderReady(request: MarkOrderReadyRequest, ctx: RequestContext): Promise<MarkOrderReadyResponse> {
    const caller = await this.access.authorise(ctx, request.outletId);
    return this.decide(
      ctx,
      caller,
      "MarkOrderReady",
      request,
      MarkOrderReadyRequest,
      MarkOrderReadyResponse,
      async (tx, t, now) => {
        if (t.status !== "preparing") {
          throw failedPrecondition("TICKET_NOT_PREPARING", `Order #${t.ticketNumber} isn't being prepared.`, {
            status: t.status,
          });
        }
        const patch: TicketPatch = { status: "ready", readyAt: now, actedBy: ctx.userId ?? null };
        if (t.source === "demo") Object.assign(patch, this.demo.riderOnReady(t, now));
        const row = await this.tickets.update(tx, t.orderId, patch);
        if (t.source === "order") {
          await this.events.ticketReady(tx, {
            outletId: t.outletId,
            orderId: t.orderId,
            orderNumber: t.orderNumber,
            actor: actorOf(ctx, t.outletId),
            occurredAt: now,
          });
        }
        return row;
      },
    );
  }

  async handOverOrder(request: HandOverOrderRequest, ctx: RequestContext): Promise<HandOverOrderResponse> {
    const caller = await this.access.authorise(ctx, request.outletId);
    return this.decide(
      ctx,
      caller,
      "HandOverOrder",
      request,
      HandOverOrderRequest,
      HandOverOrderResponse,
      async (tx, t, now) => {
        if (t.status !== "ready") {
          throw failedPrecondition("TICKET_NOT_READY", `Order #${t.ticketNumber} isn't ready yet.`, {
            status: t.status,
          });
        }
        const row = await this.tickets.update(tx, t.orderId, {
          status: "picked_up",
          pickedUpAt: now,
          closedAt: now,
          riderAtCounter: false,
          actedBy: ctx.userId ?? null,
        });
        if (t.source === "order") {
          await this.events.ticketHandedOver(tx, {
            outletId: t.outletId,
            orderId: t.orderId,
            orderNumber: t.orderNumber,
            actor: actorOf(ctx, t.outletId),
            occurredAt: now,
          });
        }
        return row;
      },
    );
  }

  /** Shared shape of the four decisions: idempotency + lock + outlet check + transition. */
  private decide<Req extends { outletId: string; orderId: string; idempotencyKey: string }>(
    ctx: RequestContext,
    caller: OutletCaller,
    rpc: string,
    request: Req,
    requestCodec: Codec<Req>,
    responseCodec: Codec<{ ticket?: ReturnType<typeof toTicket> | undefined }>,
    transition: (tx: Tx, ticket: TicketRow, now: Date) => Promise<TicketRow>,
  ): Promise<{ ticket: ReturnType<typeof toTicket> }> {
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `${rpc}:${caller.outlet.id}`,
          key: request.idempotencyKey,
          request: requestCodec.encode(request).finish(),
          codec: responseCodec as Codec<{ ticket: ReturnType<typeof toTicket> }>,
        },
        async () => {
          const ticket = await this.tickets.lock(tx, request.orderId);
          if (!ticket || ticket.outletId !== caller.outlet.id) throw ticketNotFound(request.orderId);
          const row = await transition(tx, ticket, new Date());
          return { ticket: toTicket(row) };
        },
      ),
    );
  }
}

function ticketNotFound(orderId: string) {
  return notFound("TICKET_NOT_FOUND", "That order is no longer on the board.", { order_id: orderId });
}

function ticketMissed(t: TicketRow) {
  return failedPrecondition("TICKET_MISSED", `Order #${t.ticketNumber} wasn't accepted in time.`, {
    accept_by: t.acceptBy.toISOString(),
  });
}

function ticketClosed(t: TicketRow) {
  return failedPrecondition("TICKET_CLOSED", `Order #${t.ticketNumber} is closed.`, {
    status: t.status as TicketStatusDb,
  });
}
