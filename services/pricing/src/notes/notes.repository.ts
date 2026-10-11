import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { noteProjections, notes } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";

export type NoteRow = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

/**
 * Data access for the notes aggregate. Methods take the Queryable/Tx explicitly so the caller
 * decides the transaction boundary (state + outbox + idempotency key commit together).
 */
@Injectable()
export class NotesRepository {
  async insert(tx: Tx, note: NewNote): Promise<NoteRow> {
    const [row] = await tx.insert(notes).values(note).returning();
    if (!row) throw new Error("insert returned no row");
    return row;
  }

  async findById(db: Queryable, id: string): Promise<NoteRow | undefined> {
    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    return row;
  }

  async upsertProjection(
    tx: Tx,
    projection: { noteId: string; text: string; amountMinor: number },
  ): Promise<void> {
    await tx
      .insert(noteProjections)
      .values(projection)
      .onConflictDoUpdate({
        target: noteProjections.noteId,
        set: {
          text: projection.text,
          amountMinor: projection.amountMinor,
          appliedCount: sql`${noteProjections.appliedCount} + 1`,
          projectedAt: sql`now()`,
        },
      });
  }
}
