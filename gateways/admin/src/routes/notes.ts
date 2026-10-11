import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Note as NoteMessage, TemplateServiceClient } from "@kade/proto/kade/template/v1/template";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { unary, type CallContext } from "../grpc/call.js";
import type { Hub } from "../hub.js";
import { fromRupees, toRupees } from "../money.js";
import { CreateNote, Note, problems, ref } from "../schemas.js";

interface Deps {
  template: TemplateServiceClient;
  hub: Hub;
  callContext: (req: FastifyRequest, reply: FastifyReply) => CallContext;
}

/** App-facing shape: whole rupees, ISO dates, no proto wrappers. */
export function toNote(note: NoteMessage | undefined): Note {
  if (!note) throw new Error("upstream returned no note");
  return {
    id: note.id,
    text: note.text,
    amount: toRupees(note.amount),
    currency: "LKR",
    createdAt: (note.createdAt ?? new Date(0)).toISOString(),
  };
}

export const noteRoutes =
  ({ template, hub, callContext }: Deps): FastifyPluginAsyncTypebox =>
  async (app) => {
    app.post(
      "/v1/notes",
      {
        schema: {
          operationId: "createNote",
          tags: ["notes"],
          summary: "Create a note",
          security: [{ bearer: [] }],
          headers: Type.Object({
            "idempotency-key": Type.Optional(
              Type.String({
                maxLength: 128,
                description: "Retry with the same key to get the original result.",
              }),
            ),
          }),
          body: ref(CreateNote),
          response: { 201: ref(Note), ...problems(400, 401, 403, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          template.createNote.bind(template),
          {
            text: req.body.text,
            amount: fromRupees(req.body.amount),
            idempotencyKey: req.headers["idempotency-key"] ?? "",
          },
          callContext(req, reply),
        );
        const note = toNote(res.note);
        if (req.identity) hub.publish(req.identity.userId, { type: "note.created", note });
        return reply.code(201).send(note);
      },
    );

    app.get(
      "/v1/notes/:id",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "getNote",
          tags: ["notes"],
          summary: "Get a note",
          params: Type.Object({ id: Type.String({ format: "uuid" }) }),
          response: { 200: ref(Note), ...problems(400, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          template.getNote.bind(template),
          { id: req.params.id },
          callContext(req, reply),
        );
        return toNote(res.note);
      },
    );
  };
