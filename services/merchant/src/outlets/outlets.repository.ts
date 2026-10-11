import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, gte, ilike, inArray, isNotNull, lt, min, or, sql, type SQL } from "drizzle-orm";
import { outlets, tickets } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

export type OutletRow = typeof outlets.$inferSelect;
export type NewOutlet = typeof outlets.$inferInsert;

export interface OutletStats {
  ordersWeek: number;
  decided: number;
  accepted: number;
  oldestWaitingSince: Date | null;
}

export interface OutletFilter {
  adminStatus?: string;
  zoneId?: string;
  query?: string;
}

@Injectable()
export class OutletsRepository {
  async find(db: Queryable, id: string): Promise<OutletRow | undefined> {
    const [row] = await db.select().from(outlets).where(eq(outlets.id, id));
    return row;
  }

  /** Row lock for read-modify-write (status changes publish previous → next). */
  async lock(tx: Tx, id: string): Promise<OutletRow | undefined> {
    const [row] = await tx.select().from(outlets).where(eq(outlets.id, id)).for("update");
    return row;
  }

  async findMany(db: Queryable, ids: string[]): Promise<OutletRow[]> {
    if (ids.length === 0) return [];
    return db.select().from(outlets).where(inArray(outlets.id, ids));
  }

  async insert(tx: Tx, row: NewOutlet): Promise<OutletRow> {
    const [created] = await tx.insert(outlets).values(row).onConflictDoNothing().returning();
    if (created) return created;
    const existing = await this.find(tx, row.id);
    if (!existing) throw new Error("outlet insert returned no row");
    return existing;
  }

  async update(tx: Tx, id: string, change: Partial<NewOutlet>): Promise<OutletRow> {
    const [row] = await tx
      .update(outlets)
      .set({ ...change, updatedAt: new Date() })
      .where(eq(outlets.id, id))
      .returning();
    if (!row) throw new Error(`outlet ${id} vanished`);
    return row;
  }

  async list(
    db: Queryable,
    filter: OutletFilter,
    offset: number,
    limit: number,
  ): Promise<{ rows: OutletRow[]; total: number }> {
    const where: SQL[] = [];
    if (filter.adminStatus) where.push(eq(outlets.adminStatus, filter.adminStatus));
    if (filter.zoneId) where.push(eq(outlets.zoneId, filter.zoneId));
    if (filter.query) {
      const q = `%${filter.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(outlets.name, q), ilike(outlets.area, q), ilike(outlets.cuisine, q))!);
    }
    const cond = where.length ? and(...where) : undefined;
    const rows = await db
      .select()
      .from(outlets)
      .where(cond)
      .orderBy(asc(outlets.name))
      .offset(offset)
      .limit(limit);
    const [total] = await db.select({ n: count() }).from(outlets).where(cond);
    return { rows, total: total?.n ?? 0 };
  }

  /** Outlets whose tablet has gone quiet or whose pause has ended: the housekeeper re-evaluates these. */
  async needingStatusCheck(db: Queryable, now: Date, silentBefore: Date): Promise<OutletRow[]> {
    return db
      .select()
      .from(outlets)
      .where(
        or(
          and(
            eq(outlets.accepting, true),
            isNotNull(outlets.lastHeartbeatAt),
            lt(outlets.lastHeartbeatAt, silentBefore),
          ),
          and(isNotNull(outlets.pausedUntil), lt(outlets.pausedUntil, now)),
        ),
      );
  }

  /** Real (non-demo) ticket figures over the last 7 days, per outlet. */
  async stats(db: Queryable, outletIds: string[], now: Date): Promise<Map<string, OutletStats>> {
    const result = new Map<string, OutletStats>();
    if (outletIds.length === 0) return result;
    const since = new Date(now.getTime() - 7 * 24 * 3_600_000);
    const rows = await db
      .select({
        outletId: tickets.outletId,
        ordersWeek: count(),
        decided:
          sql<number>`count(*) filter (where ${tickets.status} <> 'new' and ${tickets.status} <> 'cancelled')`.mapWith(
            Number,
          ),
        accepted: sql<number>`count(*) filter (where ${tickets.acceptedAt} is not null)`.mapWith(Number),
        oldestWaitingSince: min(sql<Date>`case when ${tickets.status} = 'new' then ${tickets.placedAt} end`),
      })
      .from(tickets)
      .where(
        and(inArray(tickets.outletId, outletIds), eq(tickets.source, "order"), gte(tickets.placedAt, since)),
      )
      .groupBy(tickets.outletId);
    for (const r of rows) {
      result.set(r.outletId, {
        ordersWeek: r.ordersWeek,
        decided: r.decided,
        accepted: r.accepted,
        oldestWaitingSince: r.oldestWaitingSince ? new Date(r.oldestWaitingSince) : null,
      });
    }
    return result;
  }
}
