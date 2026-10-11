import { Inject, Injectable } from "@nestjs/common";
import type { Order } from "@kade/proto/kade/order/v1/order_service";
import { Database, type HasDeadline, type Tx } from "../platform/db/database.js";
import { notFound } from "../platform/grpc/errors.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";
import type { OrderEvent } from "./events.js";
import { OrderRepository, type OrderRecord } from "./order.repository.js";

export interface MutateOptions {
  /** Save even when the change emits no events (snapshot-only updates). */
  save?: boolean;
}

/**
 * Load-lock-change-save for one order: the change, its timeline entry and its events commit in one
 * transaction (outbox), and SELECT … FOR UPDATE serialises the workflow, the consumers and the RPCs.
 */
@Injectable()
export class OrderStore {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
  ) {}

  /** Runs `change` on the locked order. It mutates the order in place and returns events to emit. */
  async mutate(
    ctx: HasDeadline | undefined,
    orderId: string,
    change: (order: Order, record: OrderRecord, tx: Tx) => Promise<OrderEvent[]> | OrderEvent[],
    opts: MutateOptions = {},
  ): Promise<{ order: Order; events: OrderEvent[] }> {
    return this.database.transaction(ctx, (tx) => this.mutateIn(tx, orderId, change, opts));
  }

  async mutateIn(
    tx: Tx,
    orderId: string,
    change: (order: Order, record: OrderRecord, tx: Tx) => Promise<OrderEvent[]> | OrderEvent[],
    opts: MutateOptions = {},
  ): Promise<{ order: Order; events: OrderEvent[] }> {
    const record = await this.orders.lockById(tx, orderId);
    if (!record) throw notFound("ORDER_NOT_FOUND", "We couldn't find that order.", { orderId });
    const events = await change(record.order, record, tx);
    if (events.length > 0 || opts.save) await this.orders.save(tx, record.order);
    if (events.length > 0) await this.emit(tx, record.order.id, events);
    return { order: record.order, events };
  }

  async emit(tx: Tx, orderId: string, events: OrderEvent[]): Promise<void> {
    for (const e of events) {
      await this.outbox.append(tx, {
        aggregateType: "order",
        aggregateId: e.aggregateId ?? orderId,
        type: e.type,
        payload: e.payload,
      });
    }
  }
}
