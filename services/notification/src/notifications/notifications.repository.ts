import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, lt, lte, sql } from "drizzle-orm";
import { notifications, orderContacts, pushDevices } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type OrderContactRow = typeof orderContacts.$inferSelect;
export type PushDeviceRow = typeof pushDevices.$inferSelect;

@Injectable()
export class NotificationsRepository {
  /** Inserts unless the idempotency key exists; returns the stored row either way. */
  async insertOnce(tx: Tx, row: NewNotification): Promise<{ row: NotificationRow; created: boolean }> {
    const [inserted] = await tx.insert(notifications).values(row).onConflictDoNothing().returning();
    if (inserted) return { row: inserted, created: true };
    const [existing] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.idempotencyKey, row.idempotencyKey ?? ""));
    if (!existing) throw new Error("notification conflict without an existing row");
    return { row: existing, created: false };
  }

  async update(tx: Queryable, id: string, set: Partial<NewNotification>): Promise<NotificationRow> {
    const [row] = await tx.update(notifications).set(set).where(eq(notifications.id, id)).returning();
    if (!row) throw new Error(`notification ${id} vanished`);
    return row;
  }

  async findById(db: Queryable, id: string): Promise<NotificationRow | undefined> {
    const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
    return row;
  }

  /** Newest first; `before` is the last id of the previous page (UUIDv7 sorts by time). */
  async list(
    db: Queryable,
    filter: { userId?: string; referenceId?: string; before?: string; limit: number },
  ): Promise<NotificationRow[]> {
    const where = and(
      filter.userId ? eq(notifications.userId, filter.userId) : undefined,
      filter.referenceId ? eq(notifications.referenceId, filter.referenceId) : undefined,
      filter.before ? lt(notifications.id, filter.before) : undefined,
    );
    return db.select().from(notifications).where(where).orderBy(desc(notifications.id)).limit(filter.limit);
  }

  async count(db: Queryable, filter: { userId?: string; referenceId?: string }): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          filter.userId ? eq(notifications.userId, filter.userId) : undefined,
          filter.referenceId ? eq(notifications.referenceId, filter.referenceId) : undefined,
        ),
      );
    return row?.n ?? 0;
  }

  /** Queued messages whose time has come, locked so two replicas never send the same one. */
  async claimDue(tx: Tx, now: Date, limit: number): Promise<NotificationRow[]> {
    return tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, 1), lte(notifications.sendAt, now)))
      .orderBy(asc(notifications.sendAt))
      .limit(limit)
      .for("update", { skipLocked: true });
  }

  async devices(db: Queryable, userId: string): Promise<PushDeviceRow[]> {
    return db.select().from(pushDevices).where(eq(pushDevices.userId, userId));
  }

  async upsertDevice(tx: Queryable, device: typeof pushDevices.$inferInsert): Promise<void> {
    await tx
      .insert(pushDevices)
      .values(device)
      .onConflictDoUpdate({
        target: [pushDevices.userId, pushDevices.deviceId],
        set: { token: device.token, platform: device.platform, kind: device.kind, registeredAt: sql`now()` },
      });
  }

  async deleteDevice(tx: Queryable, userId: string, deviceId: string): Promise<void> {
    await tx
      .delete(pushDevices)
      .where(and(eq(pushDevices.userId, userId), eq(pushDevices.deviceId, deviceId)));
  }

  async contact(db: Queryable, orderId: string): Promise<OrderContactRow | undefined> {
    const [row] = await db.select().from(orderContacts).where(eq(orderContacts.orderId, orderId));
    return row;
  }

  /** Merges what an event knows about an order; empty strings never overwrite known values. */
  async upsertContact(
    tx: Tx,
    contact: Partial<typeof orderContacts.$inferInsert> & { orderId: string },
  ): Promise<OrderContactRow> {
    const existing = await this.contact(tx, contact.orderId);
    const merged = { ...existing } as Record<string, unknown>;
    for (const [key, value] of Object.entries(contact)) {
      if (value !== undefined && value !== "" && value !== 0) merged[key] = value;
    }
    const row = {
      orderNumber: "",
      customerId: "",
      ...merged,
      orderId: contact.orderId,
      updatedAt: new Date(),
    } as typeof orderContacts.$inferInsert;
    const [saved] = await tx
      .insert(orderContacts)
      .values(row)
      .onConflictDoUpdate({ target: orderContacts.orderId, set: row })
      .returning();
    return saved!;
  }
}
