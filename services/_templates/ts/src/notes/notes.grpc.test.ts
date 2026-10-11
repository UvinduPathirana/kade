import { Metadata, status } from "@grpc/grpc-js";
import { NoteCreated } from "@kade/proto/kade/template/v1/template";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database, Tx } from "../platform/db/database.js";
import { createRequestContext, type RequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";
import type { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import type { OutboxEvent, OutboxWriter } from "../platform/outbox/outbox.js";
import { NOTE_CREATED, TemplateGrpcService } from "./notes.grpc.js";
import type { NewNote, NoteRow, NotesRepository } from "./notes.repository.js";

// Handlers are plain classes: construct them with in-memory fakes, no Nest, no database.
const tx = {} as Tx;

class FakeNotes {
  rows = new Map<string, NoteRow>();
  async insert(_tx: Tx, note: NewNote): Promise<NoteRow> {
    const row = { currency: "LKR", createdBy: null, ...note } as NoteRow;
    this.rows.set(row.id, row);
    return row;
  }
  async findById(_db: unknown, id: string): Promise<NoteRow | undefined> {
    return this.rows.get(id);
  }
}

let notes: FakeNotes;
let events: OutboxEvent[];
let transactions: number;
let service: TemplateGrpcService;

beforeEach(() => {
  notes = new FakeNotes();
  events = [];
  transactions = 0;
  const database = {
    db: {},
    transaction: async <T>(_ctx: unknown, fn: (t: Tx) => Promise<T>) => {
      transactions++;
      return fn(tx);
    },
  } as unknown as Database;
  const outbox = { append: async (_t: Tx, e: OutboxEvent) => void events.push(e) } as unknown as OutboxWriter;
  const idempotency = {
    run: (_t: Tx, _o: unknown, work: () => Promise<unknown>) => work(),
  } as unknown as IdempotencyStore;
  service = new TemplateGrpcService(database, notes as unknown as NotesRepository, outbox, idempotency);
});

function ctx(userId?: string): RequestContext {
  const metadata = new Metadata();
  if (userId) metadata.set("x-user-id", userId);
  return createRequestContext({ metadata });
}

async function reasonOf(promise: Promise<unknown>): Promise<[status, string]> {
  const err = await promise.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  return [(err as DomainError).code, (err as DomainError).reason];
}

describe("createNote", () => {
  it("stores the note and emits NoteCreated in the same transaction", async () => {
    const { note } = await service.createNote(
      { text: " hi ", amount: { amountMinor: 1_150_00, currency: "LKR" }, idempotencyKey: "" },
      ctx("u1"),
    );
    expect(note).toMatchObject({ text: "hi", amount: { amountMinor: 115_000, currency: "LKR" } });
    expect(notes.rows.get(note!.id)?.createdBy).toBe("u1");
    expect(transactions).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ aggregateType: "note", aggregateId: note!.id, type: NOTE_CREATED });
    expect(NoteCreated.decode(events[0]!.payload)).toMatchObject({ noteId: note!.id, text: "hi" });
  });

  it("defaults a missing amount to Rs 0", async () => {
    const { note } = await service.createNote({ text: "free", idempotencyKey: "" }, ctx("u1"));
    expect(note?.amount).toEqual({ amountMinor: 0, currency: "LKR" });
  });

  it("requires a caller identity", async () => {
    expect(await reasonOf(service.createNote({ text: "x", idempotencyKey: "" }, ctx()))).toEqual([
      status.UNAUTHENTICATED,
      "UNAUTHENTICATED",
    ]);
    expect(events).toHaveLength(0);
  });

  it.each([
    [{ text: "   " }, "NOTE_TEXT_REQUIRED"],
    [{ text: "x".repeat(501) }, "NOTE_TEXT_TOO_LONG"],
    [{ text: "x", amount: { amountMinor: -1, currency: "LKR" } }, "NOTE_AMOUNT_INVALID"],
    [{ text: "x", amount: { amountMinor: 1, currency: "USD" } }, "CURRENCY_UNSUPPORTED"],
  ])("rejects invalid input %o with %s", async (req, reason) => {
    expect(await reasonOf(service.createNote({ idempotencyKey: "", ...req }, ctx("u1")))).toEqual([
      status.INVALID_ARGUMENT,
      reason,
    ]);
    expect(transactions).toBe(0);
  });
});

describe("getNote", () => {
  it("returns a stored note", async () => {
    const { note } = await service.createNote({ text: "a", idempotencyKey: "" }, ctx("u1"));
    expect((await service.getNote({ id: note!.id })).note).toEqual(note);
  });

  it("maps a missing note to NOT_FOUND", async () => {
    expect(await reasonOf(service.getNote({ id: "0199d3a0-0000-7000-8000-000000000001" }))).toEqual([
      status.NOT_FOUND,
      "NOTE_NOT_FOUND",
    ]);
  });

  it("rejects a malformed id before touching the database", async () => {
    expect(await reasonOf(service.getNote({ id: "42" }))).toEqual([
      status.INVALID_ARGUMENT,
      "NOTE_ID_INVALID",
    ]);
  });
});
