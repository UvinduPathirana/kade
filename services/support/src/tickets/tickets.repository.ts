import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { TicketChannel, TicketStatus } from "@kade/proto/kade/support/v1/support_service";
import { macros, orderIssues, ticketMessages, tickets } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TicketRow = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type MessageRow = typeof ticketMessages.$inferSelect;
export type NewMessage = typeof ticketMessages.$inferInsert;
export type IssueRow = typeof orderIssues.$inferSelect;
export type MacroRow = typeof macros.$inferSelect;

export interface TicketFilter {
  status?: number;
  category?: number;
  priority?: number;
  assigneeId?: string;
  unassignedOnly?: boolean;
  slaBreachedOnly?: boolean;
  orderId?: string;
  requesterId?: string;
}

@Injectable()
export class TicketsRepository {
  async insertTicket(tx: Tx, row: NewTicket): Promise<TicketRow> {
    const [saved] = await tx.insert(tickets).values(row).returning();
    return saved!;
  }

  async updateTicket(tx: Queryable, id: string, set: Partial<NewTicket>): Promise<TicketRow> {
    const [row] = await tx.update(tickets).set(set).where(eq(tickets.id, id)).returning();
    if (!row) throw new Error(`ticket ${id} vanished`);
    return row;
  }

  async findTicket(db: Queryable, id: string): Promise<TicketRow | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await db.select().from(tickets).where(eq(tickets.id, id));
    return row;
  }

  /** Row-locks the ticket: concurrent replies/resolutions on one ticket serialise. */
  async lockTicket(tx: Tx, id: string): Promise<TicketRow | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await tx.select().from(tickets).where(eq(tickets.id, id)).for("update");
    return row;
  }

  /** The requester's newest unresolved chat. */
  async openChat(db: Queryable, requesterId: string): Promise<TicketRow | undefined> {
    const [row] = await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.requesterId, requesterId),
          eq(tickets.channel, TicketChannel.TICKET_CHANNEL_CHAT),
          ne(tickets.status, TicketStatus.TICKET_STATUS_RESOLVED),
        ),
      )
      .orderBy(desc(tickets.openedAt))
      .limit(1);
    return row;
  }

  async listTickets(db: Queryable, filter: TicketFilter, now: Date, offset: number, limit: number) {
    const where = and(...conditions(filter, now));
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(tickets)
        .where(where)
        .orderBy(desc(tickets.openedAt), desc(tickets.id))
        .offset(offset)
        .limit(limit),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tickets)
        .where(where),
    ]);
    return { rows, total: total?.n ?? 0 };
  }

  /** Unanswered, unresolved tickets past their SLA that haven't been announced as breached yet. */
  async newlyBreached(tx: Tx, now: Date, limit: number): Promise<TicketRow[]> {
    return tx
      .select()
      .from(tickets)
      .where(
        and(
          ne(tickets.status, TicketStatus.TICKET_STATUS_RESOLVED),
          isNull(tickets.firstResponseAt),
          isNull(tickets.slaBreachedAt),
          lt(tickets.slaDueAt, now),
        ),
      )
      .orderBy(asc(tickets.slaDueAt))
      .limit(limit)
      .for("update", { skipLocked: true });
  }

  // ---------- messages ----------

  async insertMessage(tx: Tx, row: NewMessage): Promise<MessageRow> {
    const [saved] = await tx.insert(ticketMessages).values(row).returning();
    return saved!;
  }

  async messages(db: Queryable, ticketId: string, offset = 0, limit = 1_000): Promise<MessageRow[]> {
    return db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(asc(ticketMessages.at), asc(ticketMessages.id))
      .offset(offset)
      .limit(limit);
  }

  async countMessages(db: Queryable, ticketId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId));
    return row?.n ?? 0;
  }

  async countFrom(db: Queryable, ticketId: string, fromKind: number): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.fromKind, fromKind)));
    return row?.n ?? 0;
  }

  // ---------- issues ----------

  async findIssue(db: Queryable, orderId: string): Promise<IssueRow | undefined> {
    const [row] = await db.select().from(orderIssues).where(eq(orderIssues.orderId, orderId));
    return row;
  }

  async insertIssue(tx: Tx, row: typeof orderIssues.$inferInsert): Promise<IssueRow | undefined> {
    const [saved] = await tx.insert(orderIssues).values(row).onConflictDoNothing().returning();
    return saved;
  }

  async updateIssueByTicket(
    tx: Tx,
    ticketId: string,
    set: Partial<typeof orderIssues.$inferInsert>,
  ): Promise<void> {
    await tx.update(orderIssues).set(set).where(eq(orderIssues.ticketId, ticketId));
  }

  async issues(db: Queryable, orderIds: string[]): Promise<IssueRow[]> {
    if (orderIds.length === 0) return [];
    return db.select().from(orderIssues).where(inArray(orderIssues.orderId, orderIds));
  }

  // ---------- macros ----------

  async macros(db: Queryable): Promise<MacroRow[]> {
    return db.select().from(macros).orderBy(asc(macros.position), asc(macros.id));
  }
}

function conditions(f: TicketFilter, now: Date): (SQL | undefined)[] {
  return [
    f.status ? eq(tickets.status, f.status) : undefined,
    f.category ? eq(tickets.category, f.category) : undefined,
    f.priority ? eq(tickets.priority, f.priority) : undefined,
    f.assigneeId ? eq(tickets.assigneeId, f.assigneeId) : undefined,
    f.unassignedOnly ? isNull(tickets.assigneeId) : undefined,
    f.orderId ? eq(tickets.orderId, f.orderId) : undefined,
    f.requesterId ? eq(tickets.requesterId, f.requesterId) : undefined,
    f.slaBreachedOnly
      ? and(
          ne(tickets.status, TicketStatus.TICKET_STATUS_RESOLVED),
          or(
            and(isNull(tickets.firstResponseAt), lt(tickets.slaDueAt, now)),
            and(isNotNull(tickets.firstResponseAt), gt(tickets.firstResponseAt, tickets.slaDueAt)),
          ),
        )
      : undefined,
  ];
}
