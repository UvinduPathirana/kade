import { Inject, Injectable } from "@nestjs/common";
import { NoteCreated } from "@kade/proto/kade/template/v1/template";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { NotesRepository } from "./notes.repository.js";
import { NOTE_CREATED } from "./notes.grpc.js";

/**
 * Consumes kade.note.events. A real service would consume *other* services' topics (search reads
 * kade.restaurant.events); the template consumes its own so it is self-contained.
 * Dedup by event id and the transaction are handled by EventConsumerRunner: just write via ctx.tx.
 */
@EventConsumer({ topics: ["kade.note.events"] })
@Injectable()
export class NoteEventsConsumer {
  constructor(@Inject(NotesRepository) private readonly notes: NotesRepository) {}

  @OnEvent(NOTE_CREATED, NoteCreated)
  async noteCreated(event: NoteCreated, ctx: EventContext): Promise<void> {
    await this.notes.upsertProjection(ctx.tx, {
      noteId: event.noteId,
      text: event.text,
      amountMinor: event.amount?.amountMinor ?? 0,
    });
  }
}
