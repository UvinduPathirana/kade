import { Inject, Injectable } from "@nestjs/common";
import {
  CreateNoteRequest,
  CreateNoteResponse,
  NoteCreated,
  TemplateServiceService,
  type GetNoteRequest,
  type GetNoteResponse,
  type Note,
} from "@kade/proto/kade/template/v1/template";
import { v7 as uuidv7 } from "uuid";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";
import { NotesRepository, type NoteRow } from "./notes.repository.js";

export const NOTE_CREATED = "kade.template.v1.NoteCreated";
const MAX_TEXT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** kade.template.v1.TemplateService. One method per RPC; throw DomainErrors for expected failures. */
@GrpcService(TemplateServiceService)
@Injectable()
export class TemplateGrpcService implements GrpcHandlers<TemplateServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(NotesRepository) private readonly notes: NotesRepository,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
  ) {}

  async createNote(request: CreateNoteRequest, ctx: RequestContext): Promise<CreateNoteResponse> {
    const userId = ctx.requireUser();
    const input = validateCreateNote(request);

    // Note + outbox event + idempotency record: one transaction, so either all happen or none.
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `CreateNote:${userId}`,
          key: request.idempotencyKey,
          request: CreateNoteRequest.encode(request).finish(),
          codec: CreateNoteResponse,
        },
        async () => {
          const row = await this.notes.insert(tx, {
            id: uuidv7(),
            text: input.text,
            amountMinor: input.amountMinor,
            currency: input.currency,
            createdBy: userId,
            createdAt: new Date(),
          });
          const note = toProto(row);
          await this.outbox.append(tx, {
            aggregateType: "note",
            aggregateId: row.id,
            type: NOTE_CREATED,
            payload: NoteCreated.encode({
              noteId: note.id,
              text: note.text,
              amount: note.amount,
              createdAt: note.createdAt,
            }).finish(),
          });
          return { note };
        },
      ),
    );
  }

  async getNote(request: GetNoteRequest): Promise<GetNoteResponse> {
    if (!UUID.test(request.id)) {
      throw invalidArgument("NOTE_ID_INVALID", "Note id must be a UUID.", { field: "id" });
    }
    const row = await this.notes.findById(this.database.db, request.id);
    if (!row) throw notFound("NOTE_NOT_FOUND", "We couldn't find that note.", { id: request.id });
    return { note: toProto(row) };
  }
}

export function validateCreateNote(request: CreateNoteRequest): {
  text: string;
  amountMinor: number;
  currency: string;
} {
  const text = request.text.trim();
  if (!text) throw invalidArgument("NOTE_TEXT_REQUIRED", "Write something first.", { field: "text" });
  if (text.length > MAX_TEXT) {
    throw invalidArgument("NOTE_TEXT_TOO_LONG", `Keep it under ${MAX_TEXT} characters.`, { field: "text" });
  }
  const amountMinor = request.amount?.amountMinor ?? 0;
  const currency = request.amount?.currency || "LKR";
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw invalidArgument("NOTE_AMOUNT_INVALID", "Amount must be zero or more.", { field: "amount" });
  }
  if (currency !== "LKR") {
    throw invalidArgument("CURRENCY_UNSUPPORTED", "Only LKR is supported.", { field: "amount.currency" });
  }
  return { text, amountMinor, currency };
}

export function toProto(row: NoteRow): Note {
  return {
    id: row.id,
    text: row.text,
    amount: { amountMinor: row.amountMinor, currency: row.currency },
    createdAt: row.createdAt,
  };
}
