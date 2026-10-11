import { Injectable } from "@nestjs/common";
import { Refund } from "@kade/proto/kade/order/v1/order_service";
import { and, asc, eq } from "drizzle-orm";
import { orderRefunds } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

@Injectable()
export class RefundRepository {
  async listForOrder(db: Queryable, orderId: string): Promise<Refund[]> {
    const rows = await db
      .select()
      .from(orderRefunds)
      .where(eq(orderRefunds.orderId, orderId))
      .orderBy(asc(orderRefunds.createdAt));
    return rows.map((r) => Refund.fromJSON(r.data));
  }

  async findByKey(db: Queryable, orderId: string, key: string): Promise<Refund | undefined> {
    const [row] = await db
      .select()
      .from(orderRefunds)
      .where(and(eq(orderRefunds.orderId, orderId), eq(orderRefunds.idempotencyKey, key)));
    return row && Refund.fromJSON(row.data);
  }

  /** False when a refund with this key already exists (a concurrent retry won). */
  async insert(tx: Tx, refund: Refund, key: string): Promise<boolean> {
    const inserted = await tx
      .insert(orderRefunds)
      .values({
        id: refund.id,
        orderId: refund.orderId,
        idempotencyKey: key,
        amountMinor: refund.amount?.amountMinor ?? 0,
        method: refund.method,
        data: Refund.toJSON(refund) as object,
        createdAt: refund.at ?? new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: orderRefunds.id });
    return inserted.length > 0;
  }
}
