import { Type, type Static, type TSchema } from "typebox";

// Shared API schemas. Registered with app.addSchema() so the OpenAPI document gets named
// components (#/components/schemas/Note), which is what typed-client generators key on.

export const Note = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    text: Type.String(),
    amount: Type.Integer({ description: "Whole rupees (LKR). Rs 1,150 -> 1150." }),
    currency: Type.Literal("LKR"),
    createdAt: Type.String({ format: "date-time" }),
  },
  { $id: "Note", additionalProperties: false },
);
export type Note = Static<typeof Note>;

export const CreateNote = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 500 }),
    amount: Type.Integer({ minimum: 0, description: "Whole rupees (LKR)." }),
  },
  { $id: "CreateNote", additionalProperties: false },
);
export type CreateNote = Static<typeof CreateNote>;

export const Problem = Type.Object(
  {
    type: Type.String({ format: "uri" }),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String({ description: "User-facing message; show as-is." })),
    code: Type.String({ description: "Stable machine code, e.g. NOTE_NOT_FOUND." }),
    instance: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
  },
  { $id: "Problem", description: "RFC 9457 problem details (application/problem+json)." },
);

export const sharedSchemas = [Note, CreateNote, Problem];

/** A typed $ref to a registered schema: OpenAPI sees a reference, handlers keep the static type. */
export function ref<T extends TSchema>(schema: T) {
  const id = (schema as { $id?: string }).$id;
  if (!id) throw new Error("ref() needs a schema with an $id (and app.addSchema)");
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

/** Error responses for a route, documented as application/problem+json. */
export function problems(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((s) => [s, { content: { "application/problem+json": { schema: ref(Problem) } } }]),
  );
}
