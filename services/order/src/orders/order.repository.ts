import { Injectable } from "@nestjs/common";
import { Order, OrderStatus, PlaceOrderRequest } from "@kade/proto/kade/order/v1/order_service";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { orderNumberSeq, orders } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";
import { minor } from "./money.js";
import { FINAL_STATUSES } from "./status.js";

export type OrderRow = typeof orders.$inferSelect;

export interface OrderRecord {
  order: Order;
  request: PlaceOrderRequest;
  requestHash: string;
  idempotencyKey: string;
}

export interface OrderFilter {
  customerId?: string;
  restaurantId?: string;
  riderId?: string;
  zoneId?: string;
  statuses?: OrderStatus[];
  lateOnly?: boolean;
  activeOnly?: boolean;
  placedAfter?: Date;
  placedBefore?: Date;
  query?: string;
  oldestFirst?: boolean;
  offset: number;
  limit: number;
}

export function toRecord(row: OrderRow): OrderRecord {
  const order = Order.fromJSON(row.data);
  return {
    order,
    request: PlaceOrderRequest.fromJSON(row.request),
    requestHash: row.requestHash,
    idempotencyKey: row.idempotencyKey,
  };
}

/** Columns mirrored from the Order for filtering/sorting; written from the same object as `data`. */
function columns(order: Order) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    mode: order.mode,
    customerId: order.customer?.id ?? "",
    customerName: order.customer?.name ?? "",
    customerPhone: order.customer?.phone ?? "",
    restaurantId: order.restaurant?.id ?? "",
    riderId: order.rider?.riderId || null,
    zoneId: order.zoneId || null,
    paymentKind: order.payment?.kind ?? 0,
    totalMinor: minor(order.totals?.total),
    refundedMinor: minor(order.refunded),
    data: Order.toJSON(order) as object,
    placedAt: order.placedAt ?? null,
    dueAt: order.dueAt ?? null,
    updatedAt: order.updatedAt ?? new Date(),
  };
}

@Injectable()
export class OrderRepository {
  async nextOrderNumber(tx: Queryable): Promise<string> {
    const result = await tx.execute<{ n: string }>(sql`select nextval(${orderNumberSeq.seqName}) as n`);
    return `KD-${result.rows[0]!.n}`;
  }

  /** Inserts the PENDING order; returns false when (customer, idempotency key) already exists. */
  async insert(tx: Tx, order: Order, request: PlaceOrderRequest, requestHash: string): Promise<boolean> {
    const inserted = await tx
      .insert(orders)
      .values({
        id: order.id,
        ...columns(order),
        idempotencyKey: request.idempotencyKey,
        requestHash,
        request: PlaceOrderRequest.toJSON(request) as object,
        createdAt: order.createdAt ?? new Date(),
      })
      .onConflictDoNothing({ target: [orders.customerId, orders.idempotencyKey] })
      .returning({ id: orders.id });
    return inserted.length > 0;
  }

  async save(tx: Tx, order: Order): Promise<void> {
    await tx.update(orders).set(columns(order)).where(eq(orders.id, order.id));
  }

  async findById(db: Queryable, id: string): Promise<OrderRecord | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    return row && toRecord(row);
  }

  /** SELECT … FOR UPDATE: serialises concurrent transitions of one order. */
  async lockById(tx: Tx, id: string): Promise<OrderRecord | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
    return row && toRecord(row);
  }

  async findByNumber(db: Queryable, orderNumber: string): Promise<OrderRecord | undefined> {
    const normalised = orderNumber.trim().toUpperCase();
    const withPrefix = normalised.startsWith("KD-") ? normalised : `KD-${normalised}`;
    const [row] = await db.select().from(orders).where(eq(orders.orderNumber, withPrefix));
    return row && toRecord(row);
  }

  async findByIdempotencyKey(
    db: Queryable,
    customerId: string,
    key: string,
  ): Promise<OrderRecord | undefined> {
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.idempotencyKey, key)));
    return row && toRecord(row);
  }

  async findMany(db: Queryable, ids: string[]): Promise<Order[]> {
    const valid = ids.filter((id) => UUID.test(id));
    if (valid.length === 0) return [];
    const rows = await db.select().from(orders).where(inArray(orders.id, valid));
    const byId = new Map(rows.map((r) => [r.id, toRecord(r).order]));
    return valid.flatMap((id) => byId.get(id) ?? []);
  }

  async findActiveForCustomer(db: Queryable, customerId: string): Promise<Order | undefined> {
    const [row] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.customerId, customerId),
          notInArray(orders.status, [...FINAL_STATUSES, OrderStatus.ORDER_STATUS_PENDING]),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    return row && toRecord(row).order;
  }

  /** Earlier orders by this customer at this restaurant (the kitchen ticket's "repeat" badge). */
  async countPrevious(
    db: Queryable,
    customerId: string,
    restaurantId: string,
    excludeId: string,
  ): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(orders)
      .where(
        and(
          eq(orders.customerId, customerId),
          eq(orders.restaurantId, restaurantId),
          ne(orders.id, excludeId),
          inArray(orders.status, [OrderStatus.ORDER_STATUS_DELIVERED, OrderStatus.ORDER_STATUS_COLLECTED]),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async list(db: Queryable, f: OrderFilter): Promise<{ orders: Order[]; total: number }> {
    const where: SQL[] = [];
    if (f.customerId) where.push(eq(orders.customerId, f.customerId));
    if (f.restaurantId) where.push(eq(orders.restaurantId, f.restaurantId));
    if (f.riderId) where.push(eq(orders.riderId, f.riderId));
    if (f.zoneId) where.push(eq(orders.zoneId, f.zoneId));
    if (f.statuses?.length) where.push(inArray(orders.status, f.statuses));
    else if (!f.customerId) where.push(ne(orders.status, OrderStatus.ORDER_STATUS_PENDING));
    if (f.activeOnly || f.lateOnly) where.push(notInArray(orders.status, FINAL_STATUSES));
    if (f.lateOnly) where.push(lt(orders.dueAt, new Date()));
    if (f.placedAfter) where.push(gte(orders.createdAt, f.placedAfter));
    if (f.placedBefore) where.push(lte(orders.createdAt, f.placedBefore));
    if (f.query?.trim()) {
      const q = `%${f.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(
        or(
          ilike(orders.orderNumber, q),
          ilike(orders.customerName, q),
          ilike(orders.customerPhone, q.replace(/\s+/g, "")),
        )!,
      );
    }
    const condition = where.length ? and(...where) : undefined;
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(condition)
        .orderBy(f.oldestFirst ? asc(orders.createdAt) : desc(orders.createdAt))
        .limit(f.limit)
        .offset(f.offset),
      db.select({ n: count() }).from(orders).where(condition),
    ]);
    return { orders: rows.map((r) => toRecord(r).order), total: Number(total?.n ?? 0) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
