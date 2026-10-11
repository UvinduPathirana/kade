// Integration test against the SHARED stack (pnpm infra:up): Postgres cart, Kafka and the
// Debezium connector outbox-cart (deploy/compose/connect/register-outbox.sh cart cart).
// Override addresses with DATABASE_URL / KAFKA_BROKERS when your host ports differ.
import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import {
  NoteCreated,
  TemplateServiceClient,
  type CreateNoteRequest,
  type CreateNoteResponse,
  type GetNoteResponse,
} from "@kade/proto/kade/template/v1/template";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { NOTE_CREATED } from "../../src/notes/notes.grpc.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

const config = loadConfig({
  SERVICE_NAME: "cart",
  DATABASE_URL: "postgres://cart:cart@localhost:5432/cart",
  KAFKA_BROKERS: "localhost:19092",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
});
const TOPIC = "kade.note.events";

let app: INestApplication;
let client: TemplateServiceClient;
let pool: pg.Pool;
let kafka: KafkaJS.Kafka;
let producer: KafkaJS.Producer;

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  const port = app.get(GrpcServer).port;
  client = new TemplateServiceClient(`localhost:${port}`, credentials.createInsecure());
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  kafka = new KafkaJS.Kafka({ kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR } });
  producer = kafka.producer();
  await producer.connect();
});

afterAll(async () => {
  client?.close();
  await producer?.disconnect();
  await pool?.end();
  await app?.close();
});

function identity(userId = "user-it-1", roles = "customer"): Metadata {
  const md = new Metadata();
  md.set("x-user-id", userId);
  md.set("x-roles", roles);
  return md;
}

function createNote(req: Partial<CreateNoteRequest>, md = identity()): Promise<CreateNoteResponse> {
  const request: CreateNoteRequest = { text: "", idempotencyKey: "", ...req };
  return new Promise((resolve, reject) =>
    client.createNote(request, md, { deadline: Date.now() + 5_000 }, (err, res) =>
      err ? reject(err) : resolve(res),
    ),
  );
}

function getNote(id: string): Promise<GetNoteResponse> {
  return new Promise((resolve, reject) =>
    client.getNote({ id }, new Metadata(), { deadline: Date.now() + 2_000 }, (err, res) =>
      err ? reject(err) : resolve(res),
    ),
  );
}

async function grpcError(promise: Promise<unknown>): Promise<{ code: status; reason: string | undefined }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  return { code: err.code, reason: details ? decodeErrorInfo(details as Buffer)?.reason : undefined };
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function projection(noteId: string): Promise<{ applied_count: number } | undefined> {
  const { rows } = await pool.query("select applied_count from note_projections where note_id = $1", [
    noteId,
  ]);
  return rows[0];
}

describe("TemplateService over gRPC", () => {
  it("CreateNote writes the note and one outbox row in the same transaction", async () => {
    const { note } = await createNote({
      text: "  hello kadé  ",
      amount: { amountMinor: 115_000, currency: "LKR" },
    });
    expect(note).toMatchObject({ text: "hello kadé", amount: { amountMinor: 115_000, currency: "LKR" } });

    const { rows: notes } = await pool.query("select * from notes where id = $1", [note!.id]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ created_by: "user-it-1", amount_minor: "115000" });

    const { rows: outbox } = await pool.query("select * from outbox where aggregateid = $1", [note!.id]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ aggregatetype: "note", type: NOTE_CREATED });
    const event = NoteCreated.decode(outbox[0].payload);
    expect(event).toMatchObject({ noteId: note!.id, text: "hello kadé", amount: { amountMinor: 115_000 } });

    expect((await getNote(note!.id)).note).toEqual(note);
  });

  it("returns the original result when retried with the same idempotency key", async () => {
    const key = uuidv7();
    const first = await createNote({ text: "once", idempotencyKey: key });
    const again = await createNote({ text: "once", idempotencyKey: key });
    expect(again.note).toEqual(first.note);
    const { rows } = await pool.query("select count(*)::int as n from outbox where aggregateid = $1", [
      first.note!.id,
    ]);
    expect(rows[0].n).toBe(1);

    // Concurrent retries serialise on the key's primary key and still yield one note.
    const key2 = uuidv7();
    const results = await Promise.all(
      [1, 2, 3].map(() => createNote({ text: "race", idempotencyKey: key2 })),
    );
    expect(new Set(results.map((r) => r.note!.id)).size).toBe(1);

    expect(await grpcError(createNote({ text: "different body", idempotencyKey: key }))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("maps domain errors to status codes with an ErrorInfo reason", async () => {
    expect(await grpcError(getNote(uuidv7()))).toEqual({ code: status.NOT_FOUND, reason: "NOTE_NOT_FOUND" });
    expect(await grpcError(getNote("nope"))).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "NOTE_ID_INVALID",
    });
    expect(await grpcError(createNote({ text: "x" }, new Metadata()))).toEqual({
      code: status.UNAUTHENTICATED,
      reason: "UNAUTHENTICATED",
    });
    expect(await grpcError(createNote({ text: " " }))).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "NOTE_TEXT_REQUIRED",
    });
  });
});

describe("kade.note.events consumer", () => {
  it("projects a note created over gRPC once, via outbox -> Debezium -> Kafka", async () => {
    const { note } = await createNote({
      text: "through the outbox",
      amount: { amountMinor: 500, currency: "LKR" },
    });
    const row = await eventually(() => projection(note!.id), 45_000);
    expect(row.applied_count).toBe(1);
  });

  it("handles a replayed event exactly once (processed_events dedup)", async () => {
    const eventId = uuidv7();
    const noteId = uuidv7();
    const message = {
      key: noteId,
      value: Buffer.from(
        NoteCreated.encode({
          noteId,
          text: "replayed",
          amount: { amountMinor: 1, currency: "LKR" },
        }).finish(),
      ),
      headers: { id: eventId, eventType: NOTE_CREATED },
    };
    await producer.send({ topic: TOPIC, messages: [message, message, message] });

    await eventually(() => projection(noteId));
    // Give the duplicates time to arrive and be skipped; they are on the same partition, behind it.
    const marker = uuidv7();
    await producer.send({
      topic: TOPIC,
      messages: [{ ...message, headers: { id: marker, eventType: NOTE_CREATED } }],
    });
    await eventually(async () => {
      const { rows } = await pool.query("select 1 from processed_events where event_id = $1", [marker]);
      return rows[0];
    });
    expect((await projection(noteId))?.applied_count).toBe(2); // the original + the distinct marker event
    const { rows } = await pool.query("select count(*)::int as n from processed_events where event_id = $1", [
      eventId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("sends an undecodable event to the DLQ with the error in a header", async () => {
    const eventId = uuidv7();
    await producer.send({
      topic: TOPIC,
      messages: [
        {
          key: "poison",
          value: Buffer.from([0xff, 0xff, 0xff]),
          headers: { id: eventId, eventType: NOTE_CREATED },
        },
      ],
    });

    const dlq = kafka.consumer({
      kafkaJS: { groupId: `cart-it-dlq-${eventId}`, fromBeginning: true },
    });
    await dlq.connect();
    await dlq.subscribe({ topics: [`${TOPIC}.dlq`] });
    const found = new Promise<KafkaJS.IHeaders>((resolve) => {
      void dlq.run({
        eachMessage: async ({ message }) => {
          if (message.headers?.id?.toString() === eventId) resolve(message.headers);
        },
      });
    });
    try {
      const headers = await Promise.race([
        found,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no DLQ message")), 45_000)),
      ]);
      expect(headers.error?.toString()).toMatch(/Error/);
      expect(headers["original-topic"]?.toString()).toBe(TOPIC);
      expect(headers["failed-by"]?.toString()).toBe("cart");
    } finally {
      await dlq.disconnect();
    }
  });
});
