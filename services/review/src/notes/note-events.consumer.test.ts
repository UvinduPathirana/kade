import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../platform/db/database.js";
import type { EventContext } from "../platform/kafka/event-handler.js";
import { eventHandlersOf } from "../platform/kafka/event-handler.js";
import { NoteEventsConsumer } from "./note-events.consumer.js";
import { NOTE_CREATED } from "./notes.grpc.js";
import type { NotesRepository } from "./notes.repository.js";

describe("NoteEventsConsumer", () => {
  it("registers a handler for NoteCreated", () => {
    const consumer = new NoteEventsConsumer({} as NotesRepository);
    expect(eventHandlersOf(consumer).map((h) => h.eventType)).toEqual([NOTE_CREATED]);
  });

  it("projects the note through the consumer's transaction", async () => {
    const upsertProjection = vi.fn(async () => undefined);
    const consumer = new NoteEventsConsumer({ upsertProjection } as unknown as NotesRepository);
    const tx = {} as Tx;
    await consumer.noteCreated({ noteId: "n1", text: "hi", amount: { amountMinor: 500, currency: "LKR" } }, {
      tx,
    } as EventContext);
    expect(upsertProjection).toHaveBeenCalledWith(tx, { noteId: "n1", text: "hi", amountMinor: 500 });
  });
});
