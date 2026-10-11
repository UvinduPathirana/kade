import { Inject, Injectable } from "@nestjs/common";
import type { Order } from "@kade/proto/kade/order/v1/order_service";
import type { TicketStatusDb } from "../domain/enums.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import type { Tx } from "../platform/db/database.js";
import { advance, progressFromOrder, ticketFromOrder, ticketStatusOfOrder } from "./ticket-mapper.js";
import { TicketsRepository, type TicketPatch, type TicketRow } from "./tickets.repository.js";

/**
 * Builds and moves kitchen tickets from order/delivery events. Every method is idempotent and
 * order-insensitive: tickets only move forward (see `advance`), so replays and late events are no-ops.
 */
@Injectable()
export class TicketProjector {
  constructor(
    @Inject(TicketsRepository) private readonly tickets: TicketsRepository,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * An event with the full Order. Creates the ticket if missing (status from the order, or `status`
   * when given), then advances it.
   */
  async fromSnapshot(
    tx: Tx,
    order: Order | undefined,
    occurredAt: Date,
    status?: TicketStatusDb,
  ): Promise<TicketRow | undefined> {
    if (!order?.id) return undefined;
    const target = status ?? ticketStatusOfOrder(order);
    if (!target) return undefined;
    if (!order.restaurant?.id) {
      this.logger.warn({ orderId: order.id }, "order snapshot without restaurant id; no ticket");
      return undefined;
    }
    const fresh = ticketFromOrder(order, target, occurredAt);
    if (!fresh.repeatCount && fresh.customerId) {
      fresh.repeatCount = await this.tickets.countPrevious(
        tx,
        fresh.outletId,
        fresh.customerId,
        fresh.placedAt as Date,
      );
    }
    const { row, created } = await this.tickets.insertIfAbsent(tx, fresh);
    if (created) return row;
    const patch: TicketPatch = progressFromOrder(order, target, occurredAt);
    if (!row.rider && fresh.rider) patch.rider = fresh.rider;
    if (!row.deliveryId && fresh.deliveryId) patch.deliveryId = fresh.deliveryId;
    return this.apply(tx, row, patch);
  }

  /** A progress event for a ticket we may or may not have. Unknown tickets are skipped. */
  async progress(tx: Tx, orderId: string, patch: TicketPatch): Promise<TicketRow | undefined> {
    const row = await this.tickets.lock(tx, orderId);
    if (!row) {
      this.logger.debug({ orderId }, "progress for an unknown ticket; skipped");
      return undefined;
    }
    return this.apply(tx, row, patch);
  }

  /** Rider details are not a status: always take the latest. */
  async rider(tx: Tx, orderId: string, patch: TicketPatch): Promise<TicketRow | undefined> {
    const row = await this.tickets.lock(tx, orderId);
    if (!row) return undefined;
    return this.tickets.update(tx, orderId, patch);
  }

  private async apply(tx: Tx, row: TicketRow, patch: TicketPatch): Promise<TicketRow> {
    const change = advance(row, patch);
    if (!change) return row;
    return this.tickets.update(tx, row.orderId, change);
  }
}
