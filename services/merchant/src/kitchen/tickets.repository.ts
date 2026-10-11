import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { tickets } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

export type TicketRow = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketPatch = Partial<Omit<NewTicket, "orderId">>;

@Injectable()
export class TicketsRepository {
  async find(db: Queryable, orderId: string): Promise<TicketRow | undefined> {
    const [row] = await db.select().from(tickets).where(eq(tickets.orderId, orderId));
    return row;
  }

  async lock(tx: Tx, orderId: string): Promise<TicketRow | undefined> {
    const [row] = await tx.select().from(tickets).where(eq(tickets.orderId, orderId)).for("update");
    return row;
  }

  /** The live board: open tickets plus those closed since `closedSince`, oldest first. */
  async board(db: Queryable, outletId: string, closedSince: Date): Promise<TicketRow[]> {
    return db
      .select()
      .from(tickets)
      .where(
        and(eq(tickets.outletId, outletId), or(isNull(tickets.closedAt), gte(tickets.closedAt, closedSince))),
      )
      .orderBy(asc(tickets.placedAt), asc(tickets.orderId));
  }

  /** Inserts unless the ticket already exists; returns the row either way. */
  async insertIfAbsent(tx: Tx, row: NewTicket): Promise<{ row: TicketRow; created: boolean }> {
    const [created] = await tx.insert(tickets).values(row).onConflictDoNothing().returning();
    if (created) return { row: created, created: true };
    const existing = await this.lock(tx, row.orderId);
    if (!existing) throw new Error(`ticket ${row.orderId} vanished`);
    return { row: existing, created: false };
  }

  async insertMany(tx: Tx, rows: NewTicket[]): Promise<void> {
    if (rows.length) await tx.insert(tickets).values(rows).onConflictDoNothing();
  }

  async update(tx: Tx, orderId: string, patch: TicketPatch): Promise<TicketRow> {
    const [row] = await tx
      .update(tickets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tickets.orderId, orderId))
      .returning();
    if (!row) throw new Error(`ticket ${orderId} vanished`);
    return row;
  }

  /**
   * New tickets past accept_by become "missed" (closed at accept_by). The order workflow's timer is
   * the authority and will publish OrderRejected(TIMEOUT); this keeps the board honest meanwhile and
   * when order is not running. No event: merchant never publishes on the order's behalf.
   */
  async expireMissed(db: Queryable, now: Date, outletId?: string): Promise<number> {
    const rows = await db
      .update(tickets)
      .set({
        status: "missed",
        closedAt: sql`${tickets.acceptBy}`,
        rejectReason: "timeout",
        updatedAt: now,
      })
      .where(
        and(
          eq(tickets.status, "new"),
          lt(tickets.acceptBy, now),
          outletId ? eq(tickets.outletId, outletId) : undefined,
        ),
      )
      .returning({ id: tickets.orderId });
    return rows.length;
  }

  async deleteDemo(tx: Tx, outletId: string): Promise<void> {
    await tx.delete(tickets).where(and(eq(tickets.outletId, outletId), eq(tickets.source, "demo")));
  }

  /** Earlier tickets from this customer at this outlet (the "repeat" badge when order doesn't send it). */
  async countPrevious(db: Queryable, outletId: string, customerId: string, before: Date): Promise<number> {
    if (!customerId) return 0;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(eq(tickets.outletId, outletId), eq(tickets.customerId, customerId), lt(tickets.placedAt, before)),
      );
    return row?.n ?? 0;
  }
}
