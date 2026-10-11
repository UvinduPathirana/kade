import { Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { outletStaff, outlets } from "../db/schema.js";
import type { StaffRoleDb } from "../domain/enums.js";
import type { Queryable, Tx } from "../platform/db/database.js";

export type StaffRow = typeof outletStaff.$inferSelect;
export type NewStaff = typeof outletStaff.$inferInsert;

@Injectable()
export class StaffRepository {
  async listByOutlet(db: Queryable, outletId: string): Promise<StaffRow[]> {
    return db
      .select()
      .from(outletStaff)
      .where(eq(outletStaff.outletId, outletId))
      .orderBy(
        sql`case ${outletStaff.role} when 'owner' then 0 when 'manager' then 1 else 2 end`,
        asc(outletStaff.createdAt),
        asc(outletStaff.name),
      );
  }

  async findMember(db: Queryable, outletId: string, userId: string): Promise<StaffRow | undefined> {
    const [row] = await db
      .select()
      .from(outletStaff)
      .where(and(eq(outletStaff.outletId, outletId), eq(outletStaff.userId, userId)));
    return row;
  }

  async find(db: Queryable, outletId: string, staffId: string): Promise<StaffRow | undefined> {
    const [row] = await db
      .select()
      .from(outletStaff)
      .where(and(eq(outletStaff.outletId, outletId), eq(outletStaff.id, staffId)));
    return row;
  }

  async findByPhone(db: Queryable, outletId: string, phone: string): Promise<StaffRow | undefined> {
    const [row] = await db
      .select()
      .from(outletStaff)
      .where(and(eq(outletStaff.outletId, outletId), eq(outletStaff.phone, phone)));
    return row;
  }

  /** Outlets a signed-in user works at, with the outlet name. */
  async outletsOfUser(
    db: Queryable,
    userId: string,
  ): Promise<{ outletId: string; outletName: string; role: StaffRoleDb }[]> {
    const rows = await db
      .select({ outletId: outletStaff.outletId, outletName: outlets.name, role: outletStaff.role })
      .from(outletStaff)
      .innerJoin(outlets, eq(outlets.id, outletStaff.outletId))
      .where(eq(outletStaff.userId, userId))
      .orderBy(asc(outlets.name));
    return rows.map((r) => ({ ...r, role: r.role as StaffRoleDb }));
  }

  /** Insert unless the phone is already on the team; returns undefined on a duplicate. */
  async insert(tx: Tx, row: NewStaff): Promise<StaffRow | undefined> {
    const [created] = await tx.insert(outletStaff).values(row).onConflictDoNothing().returning();
    return created;
  }

  async setRole(tx: Tx, staffId: string, role: StaffRoleDb): Promise<void> {
    await tx.update(outletStaff).set({ role }).where(eq(outletStaff.id, staffId));
  }

  async remove(tx: Tx, staffId: string): Promise<void> {
    await tx.delete(outletStaff).where(eq(outletStaff.id, staffId));
  }

  /** Serialises team changes per outlet so the "last owner" check can't race. */
  async lockTeam(tx: Tx, outletId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"team:" + outletId}))`);
  }

  /** Signed-in staff: mark active (throttled to once a minute) and complete a pending invite. */
  async touch(db: Queryable, staffId: string, now: Date): Promise<void> {
    await db
      .update(outletStaff)
      .set({ lastActiveAt: now, pending: false })
      .where(
        and(
          eq(outletStaff.id, staffId),
          sql`(${outletStaff.lastActiveAt} is null or ${outletStaff.lastActiveAt} < ${new Date(now.getTime() - 60_000)})`,
        ),
      );
  }
}
