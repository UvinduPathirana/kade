import { Injectable } from "@nestjs/common";
import { asc, count, desc, eq } from "drizzle-orm";
import { partnerApplications } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

export type ApplicationRow = typeof partnerApplications.$inferSelect;
export type NewApplication = typeof partnerApplications.$inferInsert;

@Injectable()
export class ApplicationsRepository {
  async find(db: Queryable, id: string): Promise<ApplicationRow | undefined> {
    const [row] = await db.select().from(partnerApplications).where(eq(partnerApplications.id, id));
    return row;
  }

  async lock(tx: Tx, id: string): Promise<ApplicationRow | undefined> {
    const [row] = await tx
      .select()
      .from(partnerApplications)
      .where(eq(partnerApplications.id, id))
      .for("update");
    return row;
  }

  /** The applicant's most recent application. */
  async latestByPhone(db: Queryable, phone: string): Promise<ApplicationRow | undefined> {
    const [row] = await db
      .select()
      .from(partnerApplications)
      .where(eq(partnerApplications.ownerPhone, phone))
      .orderBy(desc(partnerApplications.submittedAt))
      .limit(1);
    return row;
  }

  /** Returns undefined when the reference is taken (caller retries with another). */
  async insert(tx: Tx, row: NewApplication): Promise<ApplicationRow | undefined> {
    const [created] = await tx.insert(partnerApplications).values(row).onConflictDoNothing().returning();
    return created;
  }

  async update(tx: Tx, id: string, change: Partial<NewApplication>): Promise<ApplicationRow> {
    const [row] = await tx
      .update(partnerApplications)
      .set(change)
      .where(eq(partnerApplications.id, id))
      .returning();
    if (!row) throw new Error(`application ${id} vanished`);
    return row;
  }

  /** Review queue: oldest first, so nobody waits longest. */
  async list(
    db: Queryable,
    status: string | undefined,
    offset: number,
    limit: number,
  ): Promise<{ rows: ApplicationRow[]; total: number }> {
    const where = status ? eq(partnerApplications.status, status) : undefined;
    const rows = await db
      .select()
      .from(partnerApplications)
      .where(where)
      .orderBy(asc(partnerApplications.submittedAt), asc(partnerApplications.id))
      .offset(offset)
      .limit(limit);
    const [total] = await db.select({ n: count() }).from(partnerApplications).where(where);
    return { rows, total: total?.n ?? 0 };
  }
}
